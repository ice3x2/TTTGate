<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import SecurityCtrl from '../controller/SecurityCtrl';
    import type {BanEntry, CountryEntry, GeoConfig} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Chip from '../ui/Chip.svelte';
    import Field from '../ui/Field.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {useSession} from '../shell/session';

    // U5-06: #/security. 국가 필터(전역)와 차단된 IP. 역할 검사는 섹션 가드가 한다.
    const session = useSession();
    const POLL_MS = 10_000;
    const MODES = [{value: 'off', label: 'Off'}, {value: 'allow', label: 'Allow only listed'}, {value: 'deny', label: 'Deny listed'}];
    const UNKNOWN = [{value: 'allow', label: 'Allow unknown/private addresses'}, {value: 'deny', label: 'Deny unknown/private addresses'}];

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

    const dirty = $derived(JSON.stringify(geo) !== saved);
    const clientError = $derived(geo.mode === 'allow' && geo.countries.length === 0 ? 'Allow mode requires at least one country.' : '');
    const error = $derived(clientError || serverError);
    const off = $derived(geo.mode === 'off');
    const listed = $derived.by(() => {
        const query = filter.trim().toLowerCase();
        if(query === '') return countries;
        return countries.filter((entry) => entry.name.toLowerCase().includes(query) || entry.code.toLowerCase().includes(query));
    });

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
                toast.push({tone: 'alarm', message: result.message});
            }
        } catch(e) {
            if(e instanceof InvalidSession) session.invalidate();
            else if(!quiet) toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
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
            toast.push({tone: 'alarm', message: loadedGeo.message});
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
            failed(e, 'Unable to connect to the server.');
        }
    };

    const save = async () => {
        if(!geoLoaded || clientError || !dirty || pending) return;
        pending = true;
        serverError = '';
        try {
            const result = await SecurityCtrl.instance.putGeo($state.snapshot(geo) as GeoConfig);
            if(!result.success) {
                serverError = result.message;
                return;
            }
            geo = result.geo;
            saved = JSON.stringify(result.geo);
            toast.push({tone: 'pulse', message: 'Country filter saved.'});
            for(const warning of result.warnings) toast.push({tone: 'warn', message: warning});
        } catch(e) {
            failed(e, 'Unable to connect to the server.');
        } finally {
            pending = false;
        }
    };

    const unban = async (ban: BanEntry) => {
        try {
            const result = await SecurityCtrl.instance.unban(ban.port, ban.ip);
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            await loadBans();
            // 이미 만료된 차단이면 서버가 removed: false 를 준다.
            toast.push(result.removed ? {tone: 'pulse', message: `Unbanned ${ban.ip}.`} : {tone: 'neutral', message: `${ban.ip} was no longer banned.`});
        } catch(e) {
            failed(e, 'Unable to connect to the server.');
        }
    };

    onMount(() => {
        void (async () => {
            try {
                const [, loadedCountries] = await Promise.all([loadGeo(), SecurityCtrl.instance.countries(), loadBans()]);
                if(loadedCountries.success) countries = loadedCountries.countries;
            } catch(e) {
                if(!geoLoaded) geoFailed = true;
                failed(e, 'Unable to connect to the server.');
            }
        })();
        const poll = setInterval(() => { void loadBans(true); }, POLL_MS);
        const clock = setInterval(() => { tick = Date.now(); }, 1000);
        return () => { clearInterval(poll); clearInterval(clock); };
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <Card label="Country filter">
        {#if geoFailed}
            <div style="display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-4);">
                <span role="alert">The country filter could not be loaded. Editing is disabled.</span>
                <Button id="geo-retry" onclick={() => { void retryGeo(); }}>Retry</Button>
            </div>
        {/if}
        <fieldset disabled={!geoLoaded} style="border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label="Mode" for="geo-mode">
                <Select id="geo-mode" options={MODES} bind:value={() => geo.mode, (value) => { serverError = ''; geo.mode = value as GeoConfig['mode']; }} />
            </Field>
            <div id="geo-selected" style="display: flex; flex-wrap: wrap; gap: var(--s-2);">
                {#each geo.countries as code (code)}
                    <span style="display: inline-flex; align-items: center; gap: var(--s-1);">
                        <Chip mono>{code}</Chip>
                        <button type="button" aria-label={`Remove ${code}`} disabled={off}
                            style="border: 0; background: none; color: var(--ink-2); cursor: pointer; font: inherit;"
                            onclick={() => toggle(code, false)}>×</button>
                    </span>
                {/each}
            </div>
            <Field label="Countries" for="geo-country-filter">
                <TextInput id="geo-country-filter" placeholder="Filter countries" disabled={off} bind:value={filter} />
            </Field>
            <div id="geo-country-list" style="display: flex; flex-direction: column; gap: var(--s-2); max-height: 240px; overflow-y: auto;">
                {#each listed as entry (entry.code)}
                    <Checkbox id={`geo-country-${entry.code}`} label={`${entry.name} (${entry.code})`} disabled={off}
                        bind:checked={() => geo.countries.includes(entry.code), (on) => toggle(entry.code, on)} />
                {/each}
            </div>
            <Checkbox id="geo-apply-admin" label="Apply to admin console" bind:checked={geo.applyToAdmin} />
            <Field label="Unknown addresses" for="geo-unknown-policy">
                <Select id="geo-unknown-policy" options={UNKNOWN} bind:value={() => geo.unknownPolicy, (value) => (geo.unknownPolicy = value as GeoConfig['unknownPolicy'])} />
            </Field>
            {#if error}
                <p id="geo-error" role="alert">{error}</p>
            {/if}
            <div><Button id="geo-save" variant="primary" disabled={!geoLoaded || !dirty || clientError !== '' || pending} onclick={() => { void save(); }}>Save</Button></div>
        </fieldset>
    </Card>

    <Card label="Banned addresses">
        {#if bans.length === 0}
            <p id="ban-empty">No banned addresses.</p>
        {:else}
            <table id="ban-table" style="width: 100%; border-collapse: collapse;">
                <thead><tr><th>Port</th><th>IP</th><th>Country</th><th>Remaining</th><th></th></tr></thead>
                <tbody>
                    {#each bans as ban (`${ban.port}/${ban.ip}`)}
                        <tr data-ban={`${ban.port}/${ban.ip}`}>
                            <td class="mono">{ban.port}</td>
                            <td class="mono">{ban.ip}</td>
                            <td>{ban.country ?? '—'}</td>
                            <td class="mono">{remaining(ban)}</td>
                            <td><Button size="sm" onclick={() => { void unban(ban); }}>Unban</Button></td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </Card>
</div>
