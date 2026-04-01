<script lang="ts">
  import { isAuthenticated, loading, login } from '../lib/auth.store';

  $: if (!$loading && !$isAuthenticated) {
    login();
  }
</script>

{#if $loading}
  <div class="loading">Memuat...</div>
{:else if $isAuthenticated}
  <slot />
{/if}

<style>
  .loading {
    display: flex;
    justify-content: center;
    padding: 4rem;
    color: #666;
  }
</style>
