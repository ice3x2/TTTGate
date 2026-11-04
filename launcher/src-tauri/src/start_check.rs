//! 데몬을 띄운 뒤 실제로 도는지 판단한다(#322). `-daemon` 의 종료 코드 0 은 자식을 띄웠다는 뜻일 뿐이다.

use crate::cli::DaemonStatus;
use crate::runner::{holds_for, poll_until};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    /// 같은 프로세스가 정해진 시간 동안 계속 돌았다.
    Running,
    /// 떴다가 멈췄거나 PID 가 바뀌었다(sentinel 이 다시 띄움). 포트 충돌 같은 실패다.
    StoppedAfterStart,
    /// 상태를 한 번도 읽지 못했다. 정상으로 떴을 수 있으므로 멈추지 않는다.
    StatusUnknown,
}

/// `read` 는 상태를 한 번 읽는다(못 읽으면 None). 먼저 최대 `wait` 번 뜨기를 기다리고, 그다음 `hold` 번 같은 PID 인지 본다.
/// 상태를 읽지 못한 것은 멈춘 것이 아니다. 멈췄거나 PID 가 바뀐 것을 본 때만 실패다.
pub fn judge_start(wait: u32, hold: u32, interval: Duration, mut read: impl FnMut() -> Option<DaemonStatus>) -> StartOutcome {
    let mut first_pid = None;
    let mut seen_status = false;
    let started = poll_until(wait, interval, || {
        let status = read();
        seen_status |= status.is_some();
        first_pid = status.filter(|status| status.running).and_then(|status| status.pid);
        first_pid.is_some()
    });
    if !started {
        return if seen_status { StartOutcome::StoppedAfterStart } else { StartOutcome::StatusUnknown };
    }
    let held = holds_for(hold, interval, || match read() {
        None => true,
        Some(status) => status.running && status.pid == first_pid,
    });
    if held { StartOutcome::Running } else { StartOutcome::StoppedAfterStart }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running(pid: u32) -> Option<DaemonStatus> {
        Some(DaemonStatus { version: "2.0.1".into(), running: true, mode: Some("server".into()), pid: Some(pid), daemon: true, client: None, server: None })
    }

    fn stopped() -> Option<DaemonStatus> {
        Some(DaemonStatus { version: "2.0.1".into(), running: false, mode: None, pid: None, daemon: false, client: None, server: None })
    }

    fn judge(sequence: Vec<Option<DaemonStatus>>) -> (StartOutcome, usize) {
        let mut reads = sequence.into_iter();
        let mut count = 0;
        let outcome = judge_start(3, 3, Duration::ZERO, || { count += 1; reads.next().unwrap_or(None) });
        (outcome, count)
    }

    #[test]
    fn the_same_pid_for_the_whole_hold_is_running() {
        assert_eq!(judge(vec![stopped(), running(7), running(7), running(7), running(7)]).0, StartOutcome::Running);
    }

    #[test]
    fn an_unreadable_status_during_the_hold_is_not_a_failure() {
        assert_eq!(judge(vec![running(7), None, running(7), running(7)]).0, StartOutcome::Running);
    }

    #[test]
    fn a_restarted_app_with_another_pid_is_stopped_after_start() {
        // sentinel 이 앱을 다시 띄우면 PID 가 바뀐다.
        assert_eq!(judge(vec![running(7), running(7), running(8)]).0, StartOutcome::StoppedAfterStart);
    }

    #[test]
    fn an_app_that_stops_during_the_hold_is_stopped_after_start() {
        assert_eq!(judge(vec![running(7), stopped()]).0, StartOutcome::StoppedAfterStart);
    }

    #[test]
    fn an_app_that_never_appears_is_stopped_after_start() {
        assert_eq!(judge(vec![stopped(), stopped(), stopped()]), (StartOutcome::StoppedAfterStart, 3));
    }

    #[test]
    fn a_status_that_is_never_readable_is_unknown() {
        assert_eq!(judge(vec![None, None, None]), (StartOutcome::StatusUnknown, 3));
    }
}
