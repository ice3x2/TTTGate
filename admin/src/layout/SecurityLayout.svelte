<script lang="ts">
    let listType = 'whitelist';
</script>

<main>
    <h2 class="title">
        Security
    </h2>
    <div class="round-box">
        <h3 style="margin-top: 0px">
        Block by country
        </h3>
        <div style="display: flex; align-items: center;">
            <span class="form-label">Block access</span>
            <input type="radio" bind:group={listType} value="whitelist" style="width: 20px; margin: 0 10px 0 5px">
            <span class="form-label">Allow access</span>
            <input type="radio" bind:group={listType} value="blacklist" style="width: 20px; margin: 0 10px 0 5px">
        </div>
        <div style="display: flex; align-items: center;">
            <span class="form-label">Country list</span>
        <select>



        </select>
        </div>

        <h3>
        Block IP Access
        </h3>

        <h3>
        Auto-Block frequent connections option
        </h3>
        Blocks when <input type="number" style="width: 50px; margin: 0 6px 0 6px"> connection attempts occur&nbsp;&nbsp;
        <input type="number" style="width: 50px">ms

    </div>





</main>

<style>
    main {
        margin-top: 20px;
        padding: 10px 10px 0 10px;
        display: block;
    }
</style>