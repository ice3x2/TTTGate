<script lang="ts">

    import LoginCtrl from "../controller/LoginCtrl";
    import {onMount} from "svelte";

    let _messageElement : HTMLDivElement;
    let _isEmptyPassword : boolean = false;


    onMount( async () => {
        _isEmptyPassword = await LoginCtrl.isEmptyKey();
        if (_isEmptyPassword && _messageElement) {
            _messageElement.innerHTML = 'No password has been set. Enter the desired password.';
            return;
        }
    });

    let onClickButton = async (e : MouseEvent) => {
        let input = document.querySelector('input') as HTMLInputElement;
        let password = input.value;
        if (password == '') {
            _messageElement.innerHTML = 'Please enter your password.';
            return;
        }
        if(_isEmptyPassword) {
             if (password.length < 12) {
                _messageElement.innerHTML = 'The password must be at least 12 characters long.';
                return;
            } else if (!password.match(/[0-9]/g) || !password.match(/[~!@#$%^&*()_+|<>?:{}]/g)) {
                _messageElement.innerHTML = 'The password must contain at least one number or special character.';
                return;
            }
        }
        let isSuccess = await LoginCtrl.login(password);
        if(!isSuccess) {
            _messageElement.innerHTML = 'The password is incorrect.';
        } else {
            window.location.href = '/';
        }

    }

    let onInputEnter = (e : KeyboardEvent) => {
        if(e.key == 'Enter') {
            onClickButton(null);
        }
    }

</script>

<main>
    <h2>
        Sign in
    </h2>
    <div class="input-box" >
        <input type="password" class="form-control" placeholder="Password" aria-label="Password"   on:keyup={onInputEnter} />
        <div id="login-message" bind:this={_messageElement}></div>
    </div>

    <div class="button-box">
    <button type="button" on:click={onClickButton}>OK</button>
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
        justify-content: flex-start;
        margin: 10px 0 25px 0;
    }
    #login-message {
        position: absolute;
        margin-top: 28px;
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
        height: 180px;

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
