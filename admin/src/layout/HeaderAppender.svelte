<script lang="ts">

    type Options = {
        name: string;
        value: string;
        replace?: boolean;
    }
    export let maxWidth = 280;
    export let options : Array<Options> = [{
        name: '',
        value: '',
        replace: false
    }];

    $: {
        if(options.length == 0) {
            options = [{
                name: '',
                value: '',
                replace: false
            }];
        }
    }


    let onClickAdd = (e : MouseEvent) => {
        options = [...options, {
            name: '',
            value: '',
            replace: false
        }];
    }

    let onClickRemove = (index: number) => {
        options = options.filter((item, i) => i !== index);
    }

    let generatePastelColor = (): string => {
        const hue = Math.floor(Math.random() * 360); // 0~359 사이의 색상
        const saturation = 50 + Math.floor(Math.random() * 50); // 50~100 사이의 채도
        const lightness = 90 + Math.floor(Math.random() * 6); // 90~96% 사이의 명도

        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    let backgroundColor = generatePastelColor();

</script>
<div>
    <div class="horizontal-line" style="margin-bottom: 10px; max-width: {maxWidth}px"></div>

    <div >
        {#each options as option, index}

        <div style="border-radius: 5px; padding: 10px;  background-color: {backgroundColor}; margin-bottom: 6px">
            <input type="text" style="width: {maxWidth / 2 - 40}px" bind:value={option.name}>
            <div style="width: 10px;display: inline-block;text-align: center;font-weight: bold;color: #333; ">:</div>
            <input type="text" style="width: {maxWidth / 2 - 40}px" bind:value={option.value}>
            {#if index === options.length - 1}
            <button style="width: 28px" on:click={onClickAdd}>+</button>
            {:else}
            <button style="width: 28px; font-weight: bold;" on:click={() => onClickRemove(index)}>-</button>
            {/if}
            <div style="position: relative; height: 15px; margin-top: 5px; margin-bottom: 5px">
                <input type="checkbox" style="width: 14px;" bind:checked={option.replace}>
                <div style="display: inline-block;position: relative; top: -7px; font-size: 10pt">Replace header</div>
            </div>

        </div>

        {/each}
    </div>

</div>

<style>
    .horizontal-line {
        width: 100%;
        height: 1px;
        background: #666;
    }
</style>