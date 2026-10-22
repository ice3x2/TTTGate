<script lang="ts">
  import Modal from '../src/ui/Modal.svelte';
  import Button from '../src/ui/Button.svelte';
  let open = $state(true);
</script>
<Modal bind:open title="Smoke test">
  <p>Smoke body</p>
  {#snippet footer()}<Button variant="primary" onclick={() => (open = false)}>Dismiss test alert</Button>{/snippet}
</Modal>
