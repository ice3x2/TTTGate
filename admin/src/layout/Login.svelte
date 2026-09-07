<script lang="ts">

    import LoginCtrl from "../controller/LoginCtrl";
    import {onMount} from "svelte";

    let _message = '';
    let _password = '';
    let _bootstrapToken = '';
    let _bootstrapRequired = false;
    let _pending = false;
    let _isEmptyPassword : boolean = false;


    onMount( async () => {
        _isEmptyPassword = await LoginCtrl.isEmptyKey();
        if (_isEmptyPassword) {
            _message = 'No password has been set. Enter the desired password.';
            return;
        }
    });

    let onClickButton = async () => {
        if (_pending) return;
        if (_password == '') {
            _message = 'Please enter your password.';
            return;
        }
        _pending = true;
        try {
            const result = await LoginCtrl.login(_password, _bootstrapToken || undefined);
            if(result.success) {
                window.location.href = '/';
                return;
            }
            if(result.bootstrapRequired) _bootstrapRequired = true;
            if(result.status === 429) {
                _message = 'Too many login attempts. Please try again later.';
            } else if(result.weakPassword) {
                _message = "The password does not meet the server's minimum length.";
            } else if(result.invalidBootstrapToken && _bootstrapToken) {
                _message = 'The bootstrap token is invalid. Check config/.bootstrap-token on the server.';
            } else if(result.bootstrapRequired) {
                _message = _bootstrapToken ? 'Unable to set the first password.' : 'Enter the bootstrap token to set the first password.';
            } else {
                _message = result.message || 'The password is incorrect.';
            }
        } catch {
            _message = 'Unable to connect to the server.';
        } finally {
            _pending = false;
        }

    }

    let onInputEnter = (e : KeyboardEvent) => {
        if(e.key == 'Enter') {
            onClickButton();
        }
    }

</script>

<main>
    <h2>
        Sign in
    </h2>
    <div class="input-box" >
        <input type="password" class="form-control" placeholder="Password" aria-label="Password" bind:value={_password} on:keyup={onInputEnter} />
        {#if _bootstrapRequired || _isEmptyPassword}
            <label for="bootstrap-token">Bootstrap token</label>
            <input id="bootstrap-token" type="password" class="form-control" aria-label="Bootstrap token" autocomplete="off" bind:value={_bootstrapToken} on:keyup={onInputEnter} />
            <small>Read the token from config/.bootstrap-token on the server.</small>
        {/if}
        <div id="login-message" role="alert">{_message}</div>
    </div>

    <div class="button-box">
    <button type="button" on:click={onClickButton} disabled={_pending}>OK</button>
    </div>

</main>

<style>

    button {
        width: 100px;
    }

    input {
        width: 100%;
    }

    .input-box {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        justify-content: flex-start;
        margin: 10px 0 25px 0;
    }
    #login-message {
        margin-top: 4px;
        font-size: 10pt;
        color: deeppink;
    }

    .button-box {
        width: 100%;
        display: flex;
        justify-content: flex-end;
    }

    h2 {
        margin: 0;
        padding: 0;
        font-size: 30pt;
        font-weight: bold;
    }
    main {
        box-sizing: border-box;
        top: calc(50% - 90px);

        border: 1px solid #ccc;
        position: absolute;
        flex-direction: column;
        text-align: left;
        padding: 15px;
        min-height: 180px;

        max-width: 100%;
        background: #f7f7f7;
        border-radius: 5px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    }

    @media screen and (max-width: 400px) {
        main {
            min-width: 300px;
            left: calc(50% - 150px);
            width: 300px;
        }

        #login-message {
            font-size: 8pt;
        }
    }

    @media screen and (min-width: 401px) {
        main {
            left: calc(50% - 190px);
            width: 380px;
        }

        #login-message {
            font-size: 10pt;
        }
    }

</style>
