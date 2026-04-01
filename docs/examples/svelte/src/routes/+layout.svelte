<script lang="ts">
  import { onMount } from 'svelte';
  import { initAuth } from '../lib/auth.store';

  onMount(() => {
    initAuth();
  });
</script>

<slot />
