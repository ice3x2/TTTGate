<script lang="ts">
    import type {SysInfo} from '../../controller/Types';
    import Button from '../../ui/Button.svelte';
    import Modal from '../../ui/Modal.svelte';
    import {byteToUnit} from './units';
    import {t} from '../../i18n';

    let {
        open = $bindable(false),
        sysInfo,
    }: {
        open?: boolean;
        sysInfo: SysInfo | undefined;
    } = $props();

    const interfaces = $derived(sysInfo ? Object.entries(sysInfo.network) : []);
</script>

<Modal bind:open title={t('sysinfo.title')}>
    {#if sysInfo}
        <h3>{t('sysinfo.hardware')}</h3>
        <dl>
            <dt>CPU</dt><dd>{sysInfo.cpuInfo.model}</dd>
            <dt>{t('sysinfo.clock')}</dt><dd>{sysInfo.cpuInfo.speed}</dd>
            <dt>{t('sysinfo.cores')}</dt><dd>{sysInfo.cpuInfo.cores}</dd>
            <dt>RAM</dt><dd>{byteToUnit(sysInfo.ram)}</dd>
        </dl>

        <h3>{t('sysinfo.os')}</h3>
        <dl>
            <dt>{t('sysinfo.type')}</dt><dd>{sysInfo.osInfo.type}</dd>
            <dt>{t('sysinfo.platform')}</dt><dd>{sysInfo.osInfo.platform}</dd>
            <dt>{t('sysinfo.release')}</dt><dd>{sysInfo.osInfo.release}</dd>
            <dt>{t('sysinfo.hostname')}</dt><dd>{sysInfo.osInfo.hostname}</dd>
        </dl>

        <h3>{t('sysinfo.network')}</h3>
        {#each interfaces as [name, entries] (name)}
            <h4>{name}</h4>
            {#each entries as entry}
                <dl>
                    <dt>{t('sysinfo.address')}</dt><dd>{entry.address}</dd>
                    <dt>{t('sysinfo.netmask')}</dt><dd>{entry.netmask}</dd>
                    <dt>{t('sysinfo.mac')}</dt><dd>{entry.mac}</dd>
                    <dt>{t('sysinfo.internal')}</dt><dd>{t(entry.internal ? 'sysinfo.internalYes' : 'sysinfo.internalNo')}</dd>
                    <dt>{t('sysinfo.family')}</dt><dd>{entry.family}</dd>
                    <dt>{t('sysinfo.cidr')}</dt><dd>{entry.cidr}</dd>
                </dl>
            {/each}
        {/each}
    {/if}

    {#snippet footer()}
        <Button variant="primary" onclick={() => (open = false)}>{t('common.ok')}</Button>
    {/snippet}
</Modal>

<style>
    h3 {
        font-family: var(--ff-ui);
        font-size: var(--fs-sm);
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--ink-2);
        margin: var(--s-4) 0 var(--s-2);
    }
    h4 {
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--ink-1);
        margin: var(--s-3) 0 var(--s-1);
    }
    dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--s-1) var(--s-3);
        margin: 0;
    }
    dd {
        margin: 0;
        font-family: var(--ff-mono);
        word-break: break-all;
    }
</style>
