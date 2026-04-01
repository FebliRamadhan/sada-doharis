<script lang="ts">
  import ProtectedRoute from '../../components/ProtectedRoute.svelte';
  import UserProfile from '../../components/UserProfile.svelte';
  import { user, authFetch } from '../../lib/auth.store';

  let apiData = '';

  async function loadData() {
    const res = await authFetch('http://localhost:3001/auth/me');
    const json = await res.json();
    apiData = JSON.stringify(json, null, 2);
  }
</script>

<ProtectedRoute>
  <div class="dashboard">
    <header>
      <h1>Dashboard</h1>
      <UserProfile />
    </header>

    <main>
      <p>Selamat datang, <strong>{$user?.name}</strong>!</p>

      <button on:click={loadData}>Coba API Call</button>
      {#if apiData}
        <pre>{apiData}</pre>
      {/if}
    </main>
  </div>
</ProtectedRoute>

<style>
  .dashboard { max-width: 800px; margin: 0 auto; padding: 2rem; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
  button {
    padding: 0.6rem 1.5rem;
    background: #005598; color: #fff;
    border: none; border-radius: 6px;
    cursor: pointer;
  }
  pre {
    background: #f5f5f5; padding: 1rem;
    border-radius: 6px; overflow: auto;
    font-size: 0.85rem; margin-top: 1rem;
  }
</style>
