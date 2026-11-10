<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import SecurityCtrl from '../controller/SecurityCtrl';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import type {BanEntry, BlocklistEntry, CountryEntry, DenialReason, DenialStats, GeoConfig, RecentDenial} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Chip from '../ui/Chip.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {useSession} from '../shell/session';
    import {formatLocal} from '../util/relativeTime';
    import {errorMessageOf} from '../i18n/serverError';
    import {i18n, t} from '../i18n';

    // U5-06: #/security. 국가 필터(전역)와 차단된 IP. 역할 검사는 섹션 가드가 한다.
    const session = useSession();
    const POLL_MS = 10_000;
    const MODES = [{value: 'off', label: t('security.modeOff')}, {value: 'allow', label: t('security.modeAllow')}, {value: 'deny', label: t('security.modeDeny')}];
    const UNKNOWN = [{value: 'allow', label: t('security.unknownAllow')}, {value: 'deny', label: t('security.unknownDeny')}];

    let countries = $state<CountryEntry[]>([]);
    const INITIAL_GEO: GeoConfig = {mode: 'off', countries: [], applyToAdmin: true, unknownPolicy: 'allow'};
    let geo = $state<GeoConfig>({...INITIAL_GEO});
    // 서버 값을 불러오기 전에는 편집·저장을 막는다. 초기값(off)으로 저장하면 서버의 필터가 꺼진다.
    let geoLoaded = $state(false);
    let geoFailed = $state(false);
    let saved = $state(JSON.stringify(INITIAL_GEO));
    let filter = $state('');
    let serverError = $state('');
    let pending = $state(false);
    let bans = $state<BanEntry[]>([]);
    let serverTime = $state(0);
    let receivedAt = $state(0);
    let tick = $state(Date.now());
    // 관리자 차단 목록(이슈 286).
    let blocklist = $state<BlocklistEntry[]>([]);
    // 불러오기 전이나 실패했을 때 빈 목록처럼 보이면 "차단된 주소가 없다"로 오해한다. 상태를 따로 둔다.
    let blocklistLoaded = $state(false);
    let blocklistFailed = $state(false);
    let blockLimit = $state(1000);
    let tunnels = $state<Array<{forwardPort: number; protocol: string}>>([]);
    let blockAddress = $state('');
    let blockAppliesTo = $state('');
    let blockNote = $state('');
    let blockError = $state('');
    let blockPending = $state(false);
    // 이슈 327: 거절 집계와 최근 거절. 일시 차단 목록과 같은 주기로 다시 읽는다.
    let denialStats = $state<DenialStats>({ports: {}, admin: {rejectedGeo: 0}});
    let recentDenials = $state<RecentDenial[]>([]);
    let countryLookup = $state(false);
    const REASON_LABELS: Record<DenialReason, string> = {
        'geo-deny': t('security.reasonGeo'),
        'ip-blocklist': t('security.reasonBlocklist'),
        'rate-limit-ban': t('security.reasonBan'),
        'rate-limit-exceeded': t('security.reasonExceeded'),
        'concurrency-limit': t('security.reasonConcurrency'),
        // 이슈 348: 터널을 켠 사람의 IP 가 아니라서 거절했다.
        'activator-ip': t('security.reasonActivatorIp')
    };
    /** 거절이 있었던 범위만 보인다. 포트 번호 순, 관리 화면은 맨 아래. 관리 화면에는 국가 차단만 생긴다. */
    const denialRows = $derived.by(() => {
        const rows = Object.entries(denialStats.ports)
            .filter(([, s]) => s.rejectedGeo + s.rejectedBlocklist + s.rejectedBans + s.rejectedExceeded + s.rejectedConcurrency + (s.rejectedActivatorIp ?? 0) > 0)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([port, s]) => ({scope: port, cells: [s.rejectedGeo, s.rejectedBlocklist, s.rejectedBans, s.rejectedExceeded, s.rejectedConcurrency,
                s.rejectedActivatorIp ?? 0, s.bannedIps].map(String)}));
        if(denialStats.admin.rejectedGeo > 0) rows.push({scope: 'admin', cells: [String(denialStats.admin.rejectedGeo), '—', '—', '—', '—', '—', '—']});
        return rows;
    });
    let promoting = $state<BanEntry | undefined>(undefined);
    let promoteOpen = $state(false);

    const blockFull = $derived(blocklist.length >= blockLimit);
    const appliesToOptions = $derived([{value: '', label: t('security.allTunnels')},
        ...tunnels.map((tunnel) => ({value: String(tunnel.forwardPort), label: t('security.portWithProtocol', {port: tunnel.forwardPort, protocol: tunnel.protocol})}))]);
    const dirty = $derived(JSON.stringify(geo) !== saved);
    const clientError = $derived(geo.mode === 'allow' && geo.countries.length === 0 ? t('security.allowNeedsCountry') : '');
    const error = $derived(clientError || serverError);
    const off = $derived(geo.mode === 'off');
    const listed = $derived.by(() => {
        const query = filter.trim().toLowerCase();
        if(query === '') return countries;
        return countries.filter((entry) => entry.name.toLowerCase().includes(query) || entry.code.toLowerCase().includes(query));
    });

    // 확인 문구의 IP 는 고정폭 글꼴로 보인다. 문구를 IP 자리에서 둘로 나누어 그 사이에 IP 를 그린다.
    const IP_MARK = '\u0000';
    const promoteText = t('security.promoteConfirm', {ip: IP_MARK}).split(IP_MARK);

    const failed = (e: unknown, message: string) => {
        if(e instanceof InvalidSession) session.invalidate();
        else toast.push({tone: 'alarm', message});
    };

    /** 서버 시각 기준 남은 시간. 응답 뒤 흐른 시간만큼 줄인다. */
    const remaining = (ban: BanEntry): string => {
        const ms = Math.max(0, ban.bannedUntil - (serverTime + (tick - receivedAt)));
        const seconds = Math.ceil(ms / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const toggle = (code: string, on: boolean) => {
        serverError = '';
        geo.countries = on ? [...geo.countries.filter((value) => value !== code), code] : geo.countries.filter((value) => value !== code);
    };

    const loadBans = async (quiet = false) => {
        try {
            const result = await SecurityCtrl.instance.bans();
            if(result.success) {
                bans = result.bans;
                serverTime = result.serverTime;
                receivedAt = Date.now();
                tick = receivedAt;
            } else if(!quiet) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
            }
        } catch(e) {
            if(e instanceof InvalidSession) session.invalidate();
            else if(!quiet) toast.push({tone: 'alarm', message: t('common.unableToConnect')});
        }
    };

    const loadDenials = async (quiet = false) => {
        try {
            const [stats, recent] = await Promise.all([SecurityCtrl.instance.stats(), SecurityCtrl.instance.denials()]);
            if(stats.success) denialStats = {ports: stats.stats.ports, admin: stats.stats.admin};
            if(recent.success) {
                recentDenials = recent.denials;
                countryLookup = recent.countryLookup;
            }
            const failure = !stats.success ? stats : !recent.success ? recent : undefined;
            if(failure && !failure.success && !quiet) toast.push({tone: 'alarm', message: errorMessageOf(failure)});
        } catch(e) {
            if(e instanceof InvalidSession) session.invalidate();
            else if(!quiet) toast.push({tone: 'alarm', message: t('common.unableToConnect')});
        }
    };

    const loadBlocklist = async () => {
        try {
            const result = await SecurityCtrl.instance.blocklist();
            if(result.success) {
                blocklist = result.entries;
                blockLimit = result.limit;
                blocklistLoaded = true;
                blocklistFailed = false;
            } else {
                blocklistFailed = true;
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
            }
        } catch(e) {
            blocklistFailed = true;
            failed(e, t('common.unableToConnect'));
        }
    };

    /** "Applies to" 선택지에 쓸 터널 목록. 읽지 못하면 All tunnels 만 고를 수 있다. */
    const loadTunnels = async () => {
        try {
            const snapshot = await ServerOptionCtrl.instance.getTunnelingOption();
            tunnels = snapshot.value.map((option) => ({forwardPort: option.forwardPort, protocol: option.protocol ?? 'tcp'}))
                .sort((a, b) => a.forwardPort - b.forwardPort);
        } catch(e) {
            if(e instanceof InvalidSession) session.invalidate();
        }
    };

    const block = async () => {
        if(blockAddress.trim() === '' || blockFull || blockPending) return;
        blockPending = true;
        blockError = '';
        try {
            const result = await SecurityCtrl.instance.block({address: blockAddress.trim(),
                port: blockAppliesTo === '' ? null : Number(blockAppliesTo), note: blockNote});
            if(!result.success) {
                blockError = errorMessageOf(result);
                // 화면이 읽은 뒤 터널이 바뀌었을 수 있다. 다음 선택을 위해 "Applies to" 를 다시 읽는다.
                if(blockAppliesTo !== '') {
                    await loadTunnels();
                    if(!tunnels.some((tunnel) => String(tunnel.forwardPort) === blockAppliesTo)) blockAppliesTo = '';
                }
                return;
            }
            blockAddress = '';
            blockNote = '';
            blockAppliesTo = '';
            await loadBlocklist();
            toast.push({tone: 'pulse', message: t('security.blocked', {address: result.entry.address})});
        } catch(e) {
            failed(e, t('common.unableToConnect'));
        } finally {
            blockPending = false;
        }
    };

    const unblock = async (entry: BlocklistEntry) => {
        try {
            const result = await SecurityCtrl.instance.unblock(entry.address);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            await loadBlocklist();
            toast.push(result.removed ? {tone: 'pulse', message: t('security.unblocked', {address: entry.address})} : {tone: 'neutral', message: t('security.alreadyUnblocked', {address: entry.address})});
        } catch(e) {
            failed(e, t('common.unableToConnect'));
        }
    };

    const askPromote = (ban: BanEntry) => {
        promoting = ban;
        promoteOpen = true;
    };

    /** 일시 차단을 차단 목록(모든 터널)으로 옮긴다. 서버가 넣은 뒤 그 일시 차단을 함께 푼다. */
    const promote = async () => {
        const ban = promoting;
        promoteOpen = false;
        if(!ban) return;
        try {
            const result = await SecurityCtrl.instance.block({address: ban.ip, note: t('security.fromBanNote', {port: ban.port}), fromBan: {port: ban.port, ip: ban.ip}});
            if(!result.success) {
                // 이미 막힌 주소면 서버가 그 일시 차단을 풀었고, 다른 관리자가 막 넣었을 수도 있다. 두 표를 다시 읽는다.
                if(result.code === 'duplicate') await Promise.all([loadBans(), loadBlocklist()]);
                toast.push({tone: result.code === 'duplicate' ? 'neutral' : 'alarm', message: errorMessageOf(result)});
                return;
            }
            await Promise.all([loadBlocklist(), loadBans()]);
            toast.push({tone: 'pulse', message: t('security.blockedPermanently', {address: result.entry.address})});
        } catch(e) {
            failed(e, t('common.unableToConnect'));
        }
    };

    const loadGeo = async () => {
        const loadedGeo = await SecurityCtrl.instance.getGeo();
        if(loadedGeo.success) {
            geo = loadedGeo.geo;
            saved = JSON.stringify(loadedGeo.geo);
            geoLoaded = true;
            geoFailed = false;
        } else {
            geoFailed = true;
            toast.push({tone: 'alarm', message: errorMessageOf(loadedGeo)});
        }
    };

    const retryGeo = async () => {
        try {
            await loadGeo();
            // 첫 불러오기가 네트워크 오류였으면 국가 목록도 비어 있다. 함께 다시 읽어야 국가를 고를 수 있다.
            if(countries.length === 0) {
                const loadedCountries = await SecurityCtrl.instance.countries();
                if(loadedCountries.success) countries = loadedCountries.countries;
            }
        } catch(e) {
            geoFailed = true;
            failed(e, t('common.unableToConnect'));
        }
    };

    const save = async () => {
        if(!geoLoaded || clientError || !dirty || pending) return;
        pending = true;
        serverError = '';
        try {
            const result = await SecurityCtrl.instance.putGeo($state.snapshot(geo) as GeoConfig);
            if(!result.success) {
                serverError = errorMessageOf(result);
                return;
            }
            geo = result.geo;
            saved = JSON.stringify(result.geo);
            toast.push({tone: 'pulse', message: t('security.geoSaved')});
            for(const warning of result.warnings) toast.push({tone: 'warn', message: warning});
        } catch(e) {
            failed(e, t('common.unableToConnect'));
        } finally {
            pending = false;
        }
    };

    const unban = async (ban: BanEntry) => {
        try {
            const result = await SecurityCtrl.instance.unban(ban.port, ban.ip);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            await loadBans();
            // 이미 만료된 차단이면 서버가 removed: false 를 준다.
            toast.push(result.removed ? {tone: 'pulse', message: t('security.unbanned', {ip: ban.ip})} : {tone: 'neutral', message: t('security.alreadyUnbanned', {ip: ban.ip})});
        } catch(e) {
            failed(e, t('common.unableToConnect'));
        }
    };

    onMount(() => {
        void (async () => {
            try {
                const [, loadedCountries] = await Promise.all([loadGeo(), SecurityCtrl.instance.countries(), loadBans(), loadBlocklist(), loadTunnels(), loadDenials()]);
                if(loadedCountries.success) countries = loadedCountries.countries;
            } catch(e) {
                if(!geoLoaded) geoFailed = true;
                failed(e, t('common.unableToConnect'));
            }
        })();
        const poll = setInterval(() => { void loadBans(true); void loadDenials(true); }, POLL_MS);
        const clock = setInterval(() => { tick = Date.now(); }, 1000);
        return () => { clearInterval(poll); clearInterval(clock); };
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <Card label={t('security.countryFilter')}>
        {#if geoFailed}
            <div style="display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-4);">
                <span role="alert">{t('security.geoLoadFailed')}</span>
                <Button id="geo-retry" onclick={() => { void retryGeo(); }}>{t('common.retry')}</Button>
            </div>
        {/if}
        <fieldset disabled={!geoLoaded} style="border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label={t('security.mode')} for="geo-mode">
                <Select id="geo-mode" options={MODES} bind:value={() => geo.mode, (value) => { serverError = ''; geo.mode = value as GeoConfig['mode']; }} />
            </Field>
            <div id="geo-selected" style="display: flex; flex-wrap: wrap; gap: var(--s-2);">
                {#each geo.countries as code (code)}
                    <span style="display: inline-flex; align-items: center; gap: var(--s-1);">
                        <Chip mono>{code}</Chip>
                        <button type="button" aria-label={t('security.removeCountry', {code})} disabled={off}
                            style="border: 0; background: none; color: var(--ink-2); cursor: pointer; font: inherit;"
                            onclick={() => toggle(code, false)}>×</button>
                    </span>
                {/each}
            </div>
            <Field label={t('security.countries')} for="geo-country-filter">
                <TextInput id="geo-country-filter" placeholder={t('security.filterCountries')} disabled={off} bind:value={filter} />
            </Field>
            <div id="geo-country-list" style="display: flex; flex-direction: column; gap: var(--s-2); max-height: 240px; overflow-y: auto;">
                {#each listed as entry (entry.code)}
                    <Checkbox id={`geo-country-${entry.code}`} label={`${entry.name} (${entry.code})`} disabled={off}
                        bind:checked={() => geo.countries.includes(entry.code), (on) => toggle(entry.code, on)} />
                {/each}
            </div>
            <Checkbox id="geo-apply-admin" label={t('security.applyToAdmin')} bind:checked={geo.applyToAdmin} />
            <Field label={t('security.unknownAddresses')} for="geo-unknown-policy">
                <Select id="geo-unknown-policy" options={UNKNOWN} bind:value={() => geo.unknownPolicy, (value) => (geo.unknownPolicy = value as GeoConfig['unknownPolicy'])} />
            </Field>
            {#if error}
                <p id="geo-error" role="alert">{error}</p>
            {/if}
            <div><Button id="geo-save" variant="primary" disabled={!geoLoaded || !dirty || clientError !== '' || pending} onclick={() => { void save(); }}>{t('common.save')}</Button></div>
        </fieldset>
    </Card>

    <Card label={t('security.blockedAddresses')}>
        <div style="display: flex; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; margin-bottom: var(--s-4);">
            <p style="margin: 0;">{t('security.blockedNote')}</p>
            {#if blocklistLoaded}
                <span id="block-count" class="mono">{blocklist.length.toLocaleString(i18n().intl)} / {blockLimit.toLocaleString(i18n().intl)}</span>
            {/if}
        </div>
        <form style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-end;" onsubmit={(e) => { e.preventDefault(); void block(); }}>
            <Field label={t('security.addressOrRange')} for="block-address">
                <TextInput id="block-address" placeholder={t('security.addressPlaceholder')} invalid={blockError !== ''}
                    bind:value={() => blockAddress, (value) => { blockError = ''; blockAddress = value; }} />
            </Field>
            <Field label={t('security.appliesTo')} for="block-applies-to">
                <Select id="block-applies-to" options={appliesToOptions} bind:value={blockAppliesTo} />
            </Field>
            <Field label={t('security.noteOptional')} for="block-note">
                <TextInput id="block-note" placeholder={t('security.notePlaceholder')} bind:value={blockNote} />
            </Field>
            <Button id="block-submit" type="submit" variant="primary" disabled={!blocklistLoaded || blockAddress.trim() === '' || blockFull || blockPending}>{t('security.block')}</Button>
        </form>
        {#if blockError}
            <p id="block-error" role="alert">{blockError}</p>
        {/if}
        {#if blockFull}
            <p id="block-full" role="status">{t('security.blocklistFull')}</p>
        {/if}
        {#if blocklistFailed}
            <div style="display: flex; align-items: center; gap: var(--s-3); margin-top: var(--s-4);">
                <span id="block-failed" role="alert">{t('security.blocklistLoadFailed')}</span>
                <Button id="block-retry" onclick={() => { void loadBlocklist(); }}>{t('common.retry')}</Button>
            </div>
        {:else if !blocklistLoaded}
            <p id="block-loading">{t('security.loading')}</p>
        {:else if blocklist.length === 0}
            <p id="block-empty">{t('security.noBlocked')}</p>
        {:else}
            <table id="block-table" style="width: 100%; border-collapse: collapse; margin-top: var(--s-4);">
                <thead><tr><th>{t('status.address')}</th><th>{t('security.appliesTo')}</th><th>{t('security.note')}</th><th>{t('security.added')}</th><th></th></tr></thead>
                <tbody>
                    {#each blocklist as entry (entry.address)}
                        <tr data-block={entry.address}>
                            <td class="mono">{entry.address}</td>
                            <td>{entry.port === null ? t('security.allTunnels') : t('security.port', {port: entry.port})}</td>
                            <td>{entry.note || '—'}</td>
                            <td>{entry.createdAt > 0 ? formatLocal(entry.createdAt, false) : '—'}{entry.createdBy ? ` · ${entry.createdBy}` : ''}</td>
                            <td><Button size="sm" onclick={() => { void unblock(entry); }}>{t('security.unblock')}</Button></td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </Card>

    <Card label={t('security.bannedAddresses')}>
        {#if bans.length === 0}
            <p id="ban-empty">{t('security.noBanned')}</p>
        {:else}
            <table id="ban-table" style="width: 100%; border-collapse: collapse;">
                <thead><tr><th>{t('security.portHeader')}</th><th>IP</th><th>{t('security.country')}</th><th>{t('security.remaining')}</th><th></th></tr></thead>
                <tbody>
                    {#each bans as ban (`${ban.port}/${ban.ip}`)}
                        <tr data-ban={`${ban.port}/${ban.ip}`}>
                            <td class="mono">{ban.port}</td>
                            <td class="mono">{ban.ip}</td>
                            <td>{ban.country ?? '—'}</td>
                            <td class="mono">{remaining(ban)}</td>
                            <td style="white-space: nowrap;">
                                <Button size="sm" onclick={() => { void unban(ban); }}>{t('security.unban')}</Button>
                                <Button size="sm" variant="danger" onclick={() => askPromote(ban)}>{t('security.blockPermanently')}</Button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </Card>

    <Card label={t('security.denialsByPort')}>
        {#if denialRows.length === 0}
            <p id="denial-stats-empty">{t('security.noDenials')}</p>
        {:else}
            <table id="denial-stats-table" style="width: 100%; border-collapse: collapse;">
                <thead><tr><th>{t('security.portHeader')}</th><th>{t('security.reasonGeo')}</th><th>{t('security.reasonBlocklist')}</th><th>{t('security.reasonBan')}</th><th>{t('security.reasonExceeded')}</th><th>{t('security.reasonConcurrency')}</th><th>{t('security.reasonActivatorIp')}</th><th>{t('security.bannedIps')}</th></tr></thead>
                <tbody>
                    {#each denialRows as row (row.scope)}
                        <tr data-scope={row.scope}>
                            <td class="mono">{row.scope}</td>
                            {#each row.cells as cell, index (index)}<td class="mono">{cell}</td>{/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </Card>

    <Card label={t('security.recentDenials')}>
        {#if !countryLookup}
            <p id="denial-country-note">{t('security.countryNote')}</p>
        {/if}
        {#if recentDenials.length === 0}
            <p id="denial-recent-empty">{t('security.noDenials')}</p>
        {:else}
            <table id="denial-recent-table" style="width: 100%; border-collapse: collapse;">
                <thead><tr><th>{t('security.time')}</th><th>IP</th><th>{t('security.country')}</th><th>{t('security.portHeader')}</th><th>{t('security.reason')}</th></tr></thead>
                <tbody>
                    {#each recentDenials as denial, index (index)}
                        <tr>
                            <td>{formatLocal(denial.at, true)}</td>
                            <td class="mono">{denial.ip}</td>
                            <td>{denial.country ?? '—'}</td>
                            <td class="mono">{denial.scope}</td>
                            <td>{REASON_LABELS[denial.reason] ?? denial.reason}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </Card>
</div>

<Modal bind:open={promoteOpen} title={t('security.blockPermanently')}>
    {promoteText[0]}<span class="mono">{promoting?.ip}</span>{promoteText[1]}
    {#if blockFull}
        <p id="promote-full" role="status">{t('security.promoteFull')}</p>
    {/if}
    {#snippet footer()}
        <Button onclick={() => (promoteOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="danger" onclick={() => { void promote(); }}>{t('security.blockPermanently')}</Button>
    {/snippet}
</Modal>
