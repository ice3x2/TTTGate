<script lang="ts">

    type Options = {
        from: string;
        to: string;
        regex: boolean;
    }
    export let maxWidth = 280;
    export let options : Array<Options> = [{
        from: '',
        to: '',
        regex: false
    }];

    $:{
        if(options.length == 0) {
            options = [{
                from: '',
                to: '',
                regex: false
            }];
        }
    }


    let onClickAdd = (e : MouseEvent) => {
        options = [...options, {
            from: '',
            to: '',
            regex: false
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

    <div style="margin-bottom: 10px; width: {maxWidth}px">
        {#each options as option, index}
            <div style="background: {backgroundColor};  padding: 10px; border-radius: 5px; margin-bottom: 10px">
                <div class="form-label">From</div>
                <input type="text" style="width: {maxWidth - 25}px" bind:value={option.from}>
                <div class="form-label">To</div>
                <input type="text" style="width: {maxWidth - 25}px;" bind:value={option.to}>
                <div style="margin-top: 10px;margin-bottom: 10px;position: relative ">
                    <div style="position: relative; height: 20px; left: 0">
                        <input type="checkbox"  style="width: 14px;"  bind:checked={option.regex}>
                        <div style="display: inline-block;position: relative; top: -8px; font-size: 10pt">Regex</div>
                    </div>
                    {#if index === options.length -1}
                        <button style="position: absolute; right: 0px; top: 0" on:click={onClickAdd}>Add</button>
                    {:else }
                        <button style="position: absolute; right: 0px; top: 0" on:click={()=>onClickRemove(index)}>Remove</button>
                    {/if}
                </div>
            </div>
        {/each}
    </div>

</div>

<style>


    .horizontal-line {
        width: 100%;
        height: 1px;
        background: #aaa;
    }
</style>