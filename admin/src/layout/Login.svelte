<script lang="ts">

    import imgReload from '../assets/reload.png';
    import LoginCtrl from "../controller/LoginCtrl";
    import {onMount} from "svelte";
    import Loading from "../component/Loading.svelte";

    const LOADING_IMAGE = 'data:image/gif;base64,R0lGODlhGAAYAPcBAAAAAAD/AAEBAQICAgMDAwQEBAgICAoKCgsLCwwMDBAQEBISEhUVFRkZGR4eHiEhISIiIiMjIyUlJSgoKCkpKSsrKzExMTQ0NDc3Nzg4ODw8PENDQ0REREdHR0hISElJSUxMTFFRUVNTU2FhYW1tbXR0dHl5eXp6enx8fICAgIGBgYWFhYiIiJOTk5SUlJaWlp2dnaysrK+vr7CwsLKysrq6ur+/v8DAwMLCwsrKyszMzNDQ0NHR0dXV1dbW1tra2t3d3d/f3+Dg4OHh4ePj4+Tk5OXl5ebm5ujo6Orq6vX19ff39/z8/P7+/v///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBAABACwAAAAAGAAYAIcAAAAA/wABAQECAgIDAwMEBAQICAgKCgoLCwsMDAwQEBASEhIVFRUZGRkeHh4hISEiIiIjIyMlJSUoKCgpKSkrKysxMTE0NDQ3Nzc4ODg8PDxDQ0NERERHR0dISEhJSUlMTExRUVFTU1NhYWFtbW10dHR5eXl6enp8fHyAgICBgYGFhYWIiIiTk5OUlJSWlpadnZ2srKyvr6+wsLCysrK6urq/v7/AwMDCwsLKysrMzMzQ0NDR0dHV1dXW1tba2trd3d3f39/g4ODh4eHj4+Pk5OTl5eXm5ubo6Ojq6ur19fX39/f8/Pz+/v7///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8IuQCZOBFIcKDBgggNOmmysCHDhw4jPkxI8aBFgRIzQty4sKLHi040iuTY5KNJhSRHSjx50omSEQYMjFjC8GXMmTVhyqTJZASAAQAIjBjoE6hQoj+DDnViAMAMGgAMMGz6NOpUp1ClMjkAgIaMAQUGcvUKVmzXr2GdjBAAoO0IhmvbAnirlq3bkktGHCgwQsnAvHv7/tXL129DgRwRR1RcEiRLlCpTTnRMOWHkyI8/XpbcsbJnjJxDLwwIACH5BAUEAAEALBEACAAGAAgAAAgzAAMs0ZGjSYAfFAAAkBCkQ4AFCQJoAHDwRwABDAKkMBFAwYoAIAOwcPKCwwYYTEAaBBkQACH5BAUFAAEALBEACAAGAAcAAAgwAAO00HDhRYAUAgIEAKBiQQAWKgIkSMjDR4ABHwIoMBCAwxALCi0UCcDEBw8nAQICACH5BAUEAAEALBEABwAGAAgAAAg3AAPwMIFiRwAaAggAKBDjQYAOHgJIIBAACZEAACYEuJAhAIUbBhQmqNGESIsWQZwECOCEycqAAAAh+QQFBAABACwRAAYABgAIAAAINQADKKlRg0mAHg4ACHDgQwMABwwGZAAQIEiQAAIaBCBBIoCCFgEUBmjhJIaIEDIMOmmyMkBAACH5BAUEAAEALBEABgAGAAcAAAgvAAOgmABhxZISAAIEAFBCQYAXLQIcGBBAh44ABURgTAgiCQeFG5IEYJKkiJMAAQEAIfkEBQQAAQAsCQAGAA4ACgAACGQAAwgcKHDJiAMFRighSHBEwwBLdORoMvBAABoyAhT4QQEAAAlBBBa4SCPAgQ4BFiQIoEGgwwEuAQT48SOAAIFKRhQ4oJBBgBQmAigg6ISJwBUEWTAc6OQFhw0wjC4dSHHqwIAAACH5BAUEAAEALAkABgAOAAkAAAhnAAMIHCjQiQ4UJnowIUhQRgGBBGYEaKHhwouBEgKA4BDgQQoBAgGoCBnAyJEAAhYEYDEygcAKATJcCCABJA8fAQYItHEAgIADNz4EUGAgAEeBQV60IBJgiAWBFoowJMjEBw8nUwcGBAAh+QQFBQABACwJAAYADgAJAAAIaQADCBw4kIkTgwJ5mECxY2CTIi1eEHFCQwABAAViCMRh4GICGw8CdPAQQIJACgEuXAhQgUAAJEQCABDoEqbMCSkzBEAZ4AGADyAAPLjREUCCGgJpALiYsQmRFi2COBmo0ISOgQcJag0QEAAh+QQFBAABACwJAAYADgAKAAAIcwADKKlRg0mAgwgR9nAAQIADHwidNJEYQAMABwwGZDjohEnHjgACBAkSQMBBJSMMGBixpEEAEiQCKDg4IsCAkCNaBGgYQGcAAwFm0PjpJIaIEDIMBjgQgIaMAQUCSKRIUwCAqzUTIlwy4kCBEUq0alUaICAAIfkEBQQAAQAsCQAGAA4ACwAACHAAA6CYAGHFkgAIEyIsAQAhgBIKFSoI8KJFgAMREw4IoENHgAIImzgRKVLEx4YgEDrRgaIEDyZJOCDckAShDAIABAyQEQBmEScJJQQI4SGAg4wOAxQxEkAA0gAWAGCwQGDC0xsIch7A8TTAkIpHAgQEACH5BAUEAAEALAEABgAWAAwAAAigAAMIHChwyYgDBUYoIciwYYARBCE6DLBER44mAw8EoCEjQIGJPygAACAhiMCPNGgE0OiwQ4AFCQJoEAhxAM2BTJzkDAAgwI8fAQQIVDKiwAGFApsMaeFCiBMGAVKYCKCAoE6COAwQAJDAxgqCLCYKnBAAA4YAFJy84LABBhOxAQgEQEKEZ1K4AyEA6PABQAS8DGkI2FogBmCGPEyc2BEgIAAh+QQFBAABACwBAAYAFgAMAAAInwADCBwo0IkOFCZ6MCHIsGEAGQUEEpjhUGALDRdeDJQQAASHAA8qphAgEICKkgGMHAlA0uGCACxOJhBYIUCGCwE4OiTJw0eAAQJtHAAg4MCNgU6aJA3wIYACAwE+CgzyogWRgUtGICgwQskQCwItFKkocEQAAAACmGXig4cTsgIRBKAhI0BEuAyhzqARACpegiPS/jT7d6CSEQYMjFgSEAAh+QQFBAABACwBAAYAFgAMAAAIngADCBw4kIkTgwQTBuBhAsWOgU2KtHhBxIlCgTQEEABQIIZAHAY2JrBxMcCDAB08BJAgkEKACxcCVChJIAASIgEACKx5M2fJCS8zBHBpEsAHEABODjySROCNkAAS1MAIYGNHgUk2bOyApAmRFi2CWBTI0ISOgSECDKiZNsDBkgQNBNCRwydchQgCuHgRIMFdhSUIBv5LkIkKCRJQNAkIACH5BAUFAAEALAEABgAWAAwAAAijAAMoqVGDSYCDCBMqPNjDAQABDnwgdNKE4kKEGgA4YDAgw0EnTECCvBgAQIAgQQIIOKhkhAEDI5aQbBCABIkACg6OCDDA5M6LLUquDBrAQIAZNIoijBFCRIwATmKICCHDYIADAWjIGFDg4AuTPINStKhTAICzPxfUvMmA5JIRBwqMUHKQQAAiQEgmtIoxQAOaGvRe/EEzwAMeghc2WUJQiZOAAAAh+QQFBAABACwBAAYAFgAMAAAInwADoJgAYcWSAAgTKlwYoAQAhABKMJyYUEGAFy0CHKBIcUAAHToCFEDYxEnJkhRFiHwIAqETHShK8GCSEAjGIgGScEC4IQlCGQQACBggA6GNA0IP2AjAJEkRJwklBAjhIYADhBUCZLgQQOrEh0WMBBAAMYCRI2MpWgCAwQKBCQilfth5deINBElx/CwglMAMjkMwonUJUyZNjhNNmgwQEAAh+QQFBAABACwBAAYAFgAMAAAIngCXjDhQYISSAAgTKlwYYIRChwwjIjwQgIaMAAUkSsxIg0YAihoR9ujBpGGAAQghBmDihGXCIxUGALgQRMmIAgcMImwypIULIU4QdgBwIAGADghbKsRhgACABDYQZvzBIwAAiRMCYMAQgAJCBQFWrAgANiKBAEiIWEU4VmYAFBIhHP0AIMJOFxgytGgikYYApwViJGTpUiMPEyd2aAwIACH5BAUEAAEALAEABgAWAAwAAAidAJ3oQGGiB5MACBMqXBhARgGEBGYwnJhQQgAQHAI8oEgRQAAjRwII4IgQxoYNMAJUCJDhQgCLHFl4DEBghY0DAAQcuJHQSROfCRUEOIEiwIIAQV60IJJwyQgEBUYogRgAiA+SIwIA8Jg1wIYACoRmnIggAA0ZAR4GEAKzwg+KBgLMoBEgLkImOXQwcUJxxMwBXUkqVDLCgIERSygGBAAh+QQFBAABACwBAAYAFgAMAAAInQADMHEyMIDBgwgTGmxSpMULIk4USjyIwwABAAlsTJxIIcCFCwEqbAygZIQBAyOWEAiAhEgAACNHIBzxAMAHEAAeIDySBKGBADNoBDBAA8DFAjEMJtlwsQMSgwcC0JARoEAAHiZM6DgYIsCAlV0DyAQAU6bEnzpyvDS4ZMSBAiOUTEQQwMWLAAkOEnTSZGMJhH9HJmSiQoIEFH0lBgQAIfkEBQQAAQAsAQAHAA4ACwAACHAAAzhpMjCAwYMHnTBRqBAhQiUjDBgYscThwREBBgAIgNFiAAMBZtD4eDBGCBExAhwIQEPGgAIGX2zM2GKEAAA4Oy4IQIJEAAZLRhwoMEKJQQIBiABByMShhgANGgR46vGH1AAPeHgM0GRJjRpKnAQEACH5BAUFAAEALAEACQAOAAkAAAhoAJs4ESgwgMGDBp3oQFGCB5ODQF60KBJABgEAAgbIMGjjAMYDNiQECOEhgAODFQJkuBBAAoAARYwEEGDwpZEjMy0AwGCBwASDIj9wMHkDwUccBmUUwEhgRoAhEnEmXNjwIUKEAwcGCAgAIfkEBQQAAQAsAQAJAA4ACQAACG0AAwgcSLBHDyYCmThROPBIhQEALgRpMqSFCyFOBHYAcCABgA44DBAAkMCGwAIBfvAIAGBCAAwYAlAQqCDAihUBFBAIgIQIS4E4IQZAAeHjBwARBDZxgSFDiyY0BIwsEGOgQoYBeJg4sYOg14AAACH5BAUEAAEALAEACQAOAAkAAAhlAAMIHDgQxoYNMAgqZAFAIIEVAZw0kThQQYATKAIsWDICQYERShwGAOJD4IgAABqeDLAhgAKLHBAEoCEjQAGBQiQIrPDDQIAZNAL4FMgkhw4mTkY0DDBgpcIASkYYMDBiyVOBAQEAIfkEBQQAAQAsAQAJAA4ACQAACGIAAwgcKFDJCAMGRiwhSHBEQ4FHkhA0EGAGjQAGkmwgAKADEoEHAtCQEaBAiAADCAQ4GcAhAAAtKerIEQBmgCUjDhQYoQRBABcvAiQY6ISJkyYBShBUylAgExUSJKBA2jRAQAAh+QQFBAABACwBAAsABgAHAAAIMAADxAghIkaAFwACBBjQYkEAEiQCMCAQgAgQhRoCNGgQQMMPjgEe8GiypEYNJU4CAgAh+QQFBAABACwBAAoABgAIAAAINwADAHnRokgAGwcACDhgo0KADBcCSAAQwMiRAAIkBPjAIYADGQUUEpjhRAeKEjyYBHDShGWAgAAAIfkEBQUAAQAsAQAJAAYACAAACDUAAwTo0YNJgCMVBgC4EKQDgAMJAHQoEOAHjwAAFARYsSKAgo4KA6Bo4gJDhhZNAjBxsjJAQAAh+QQFBQABACwBAAkABgAHAAAILwADwNiwAUYAFgACBCCwQkGAEygCLCAQAIgPhRsCKHDIQYgEhRV+BGCSQwcTJwEBADs=';

    let _messageElement : HTMLDivElement;
    let _isEmptyPassword : boolean = false;
    let _captchaInfo : {expireTime: number, token: string, width: number, height: number, image: string } = {expireTime: 0, token: '', width: 0, height: 0, image: LOADING_IMAGE};

    let _captchaValue = '';
    let _loading = false;


    onMount( async () => {

        _isEmptyPassword = await LoginCtrl.isEmptyKey();
        if (_isEmptyPassword && _messageElement) {
            _messageElement.innerHTML = 'No password has been set. Enter the desired password.';
        }
        if(_captchaInfo.expireTime == 0) {
            await loadCaptcha();
        }

    });

    let loadCaptcha = async () => {
        if(_captchaInfo.expireTime == -1) {
            console.log('Captcha is loading')
            return;
        }
        _captchaInfo.image = LOADING_IMAGE;
        _captchaInfo.expireTime = -1;
        let captcha = await LoginCtrl.captchaInfo();
        _captchaInfo = captcha;
        setTimeout(() => {
            loadCaptcha();
        }, _captchaInfo.expireTime);
    }

    let onClickButton = async () => {

        let input = document.querySelector('.input-password') as HTMLInputElement;
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
        _loading = true;
        let isSuccess = await LoginCtrl.login(password, _captchaInfo.token, _captchaValue);
        if(!isSuccess) {
            _messageElement.innerHTML = 'Password or Captcha value is incorrect.';
            _loading = false;
            await loadCaptcha();
        } else {
            window.location.href = '/';
        }
        _loading = false;

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
        <div class="captcha-box">
            <img id="login-captcha" src="{_captchaInfo.image}" alt="Captcha" style="max-width: 100%; max-height: 100%"/>
        </div>
        <div  style="margin-left: 10px">
            <img src={imgReload} on:click={()=> loadCaptcha()}  width="20" height="20" style="margin-bottom: 6px; margin-top: 2px; cursor: pointer"   >
            <input bind:value={_captchaValue} type="text" class="form-control" placeholder="Captcha" aria-label="Captcha"  />
        </div>
    </div>

    <div class="input-box" >
        <input type="password" class="form-control input-password" placeholder="Password" aria-label="Password" on:keyup={onInputEnter} />
        <div id="login-message" bind:this={_messageElement}></div>
    </div>

    <div class="button-box">
        <button type="button" on:click={onClickButton} style="width: 50%">OK</button>
    </div>

    <Loading show={_loading}></Loading>

</main>

<style>

    button {
        width: 100px;
    }

    input {
        width: 100%;
    }

    .captcha-box {
        width: 130px;
        height: 65px;
        border-radius: 5px;
        border: solid 1px #ccc;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background: white;

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

    img {
        margin: auto;
        background: white;
    }

    .button-box {
        width: 100%;
        text-align: center;
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
