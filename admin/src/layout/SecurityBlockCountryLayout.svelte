<script lang="ts">
    import InvalidSession from "../controller/InvalidSession";
    import SecurityCtrl from "../controller/SecurityCtrl";
    import AlertLayout from "../component/AlertLayout.svelte";
    import Loading from "../component/Loading.svelte";
    import {onMount} from "svelte";
    let _listTypeOfCountryBlock = 'whitelist';


    let _showLoading = false;
    let _countries : Array<{code: string, name: string}> = [];

    let _blacklistOfCountryBlock : Array<{code: string, name: string, blocked?: number}> = [];
    let _whitelistOfCountryBlock : Array<{code: string, name: string, blocked?: number}> = [];

    let _selectedCountry : string = 'all';

    let _showAlert = false;
    let _alertButton = "OK";
    let _onCloseAlert = () => {}
    let _alertMessage = '';


    onMount(async  () => {
        await _getCountries();
    });


    let _getCountries = async () => {
        _showLoading = true;

        try {
            let ctrl = SecurityCtrl.instance;
            _countries = await ctrl.getCountries();
            _showLoading = false;
        } catch (e) {
            if (e instanceof InvalidSession) {
                _showLoading = false;
                _sessionOut();
            }
            console.error(e);
        }
    }

    let _sessionOut = () => {
        _alert("Session is expired.<br/>Please login again.", "OK", () => {
            location.href = "/";
        });
    }

    let _alert = (message: string, button?: string, onClose? : ()=> void) => {
        if(button == null) {
            button = "OK";
        } else {
            _alertButton = button;
        }
        if (onClose == null) {
            _onCloseAlert = () => {}
        } else {
            _onCloseAlert = onClose;
        }
        _alertMessage = message;
        _showAlert = true;
    }

    let _toLowerButFirst  = (str: string) => {
        return str.split(" ").map((s) => {
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }).join(" ");

    }

    let _addCountry = (e: MouseEvent) => {
        let list = _listTypeOfCountryBlock === 'whitelist' ? _whitelistOfCountryBlock : _blacklistOfCountryBlock;
        if(_selectedCountry == 'all') {
            list = [];
            list = [... _countries];
            if(_listTypeOfCountryBlock === 'whitelist') {
                _whitelistOfCountryBlock = list;
            } else {
                _blacklistOfCountryBlock = list;
            }
            return;
        }


        let selected = _countries.find((c) => c.code == _selectedCountry);
        if (selected == null) {
            return;
        }

        if(!list.find((c) => c.code == selected!.code)) {
            list.push(selected);
            if(_listTypeOfCountryBlock === 'whitelist') {
                _whitelistOfCountryBlock = list;
            } else {
                _blacklistOfCountryBlock = list;
            }
        }
    }

    let _onClickRemoveCountry = (e: MouseEvent, index: number) => {
        let list = _listTypeOfCountryBlock === 'whitelist' ? _whitelistOfCountryBlock : _blacklistOfCountryBlock;
        list.splice(index, 1);
        if(_listTypeOfCountryBlock === 'whitelist') {
            _whitelistOfCountryBlock = list;
        } else {
            _blacklistOfCountryBlock = list;
        }
    }

    let _onClickClearCountries = () => {
        if(_listTypeOfCountryBlock === 'whitelist') {
            _whitelistOfCountryBlock = [];
        } else {
            _blacklistOfCountryBlock = [];
        }
    }

</script>

<main>

    <div class="round-box">
        <h3 style="margin-top: 0px; margin-bottom: 10px">
        Block by country
        </h3>
        <div style="display: flex; align-items: center;">
            <span class="form-label">Block access</span>
            <input type="radio" bind:group={_listTypeOfCountryBlock} value="blacklist" style="width: 20px; margin: 0 10px 0 5px">
            <span class="form-label">Allow access</span>
            <input type="radio" bind:group={_listTypeOfCountryBlock} value="whitelist" style="width: 20px; margin: 0 10px 0 5px">
        </div>
        <span class="form-label" style="margin-top: 10px">Country list</span>
        <div style="display: flex; align-items: center;">

        <select style="width: calc(100% - 55px);" bind:value={_selectedCountry}>
            <option value="all">All</option>
            {#each _countries as country}
                <option value={country.code}>{_toLowerButFirst(country.name)}</option>
            {/each}
        </select>
        <button style="padding: 0 10px 0 10px; margin-left: 15px" on:click={_addCountry}>Add</button>
        </div>

        <div style="margin-top: 10px; font-size: 10pt">
            {#if _listTypeOfCountryBlock === 'whitelist'}
                White list
            {:else}
                Black list
            {/if}
        </div>
        <div style="border: #ccc solid 1px; width: 100%; border-radius: 5px;">
            {#each (_listTypeOfCountryBlock === 'whitelist' ? _whitelistOfCountryBlock : _blacklistOfCountryBlock) as country, index}
                <div style="position: relative; color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;  {(_listTypeOfCountryBlock === 'whitelist' ? _whitelistOfCountryBlock : _blacklistOfCountryBlock).length -1 === index ? '' : 'border-bottom: #ccc solid 1px;'} ">
                    <span style="font-size: 8pt">{_toLowerButFirst(country.name)}</span>
                    <span style="font-size: 8pt; margin-left: 5px">({country.blocked ? country.blocked  : 0})</span>
                    <button style="position: absolute; right: 10px; height: 20px; font-size: 6pt" on:click={(e)=>{_onClickRemoveCountry(e, index)}}>X</button>
                </div>
            {/each}
            {#if (_listTypeOfCountryBlock === 'whitelist' ? _whitelistOfCountryBlock : _blacklistOfCountryBlock).length === 0}
                <div style="color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;">
                    <span style="font-size: 8pt">No country</span>
                </div>
            {/if}
        </div>
        <div style="display: flex; position: relative; width: 100%; margin-top: 10px">
            <button on:click={(e)=> {_onClickClearCountries()}}>Clear</button>
            <button style="right: 0; position: absolute">Apply</button>
        </div>


    </div>



    <Loading bind:show={_showLoading}></Loading>
    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>





</main>

<style>
    main {
        margin-top: 10px;

        display: block;
    }
</style>