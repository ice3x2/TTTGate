<script lang="ts">
    import QRCode from 'qrcode';
    import {toast} from '../../ui/toast';

    // U4-09: otpauth URI 를 로컬 canvas 에 그린다(외부 이미지 서비스 금지, D6). qrcode 는 이 파일에서만 import 한다.
    let {value, size = 192}: {value: string; size?: number} = $props();
    let canvasEl: HTMLCanvasElement;

    // toCanvas 는 모듈 격자에 맞춰 캔버스 크기를 바꾼다(192 → 191 등). 임시 캔버스에 그린 뒤 size×size 로 옮겨 크기를 지킨다.
    $effect(() => {
        const scratch = document.createElement('canvas');
        QRCode.toCanvas(scratch, value, {width: size, margin: 1, errorCorrectionLevel: 'M'})
            .then(() => {
                const context = canvasEl.getContext('2d');
                if(!context) return;
                context.imageSmoothingEnabled = false;
                context.clearRect(0, 0, size, size);
                context.drawImage(scratch, 0, 0, size, size);
            })
            .catch(() => toast.push({tone: 'alarm', message: 'Could not draw the QR code.'}));
    });
</script>

<canvas bind:this={canvasEl} id="mfa-qr" width={size} height={size} aria-label="Scan with your authenticator app"></canvas>
