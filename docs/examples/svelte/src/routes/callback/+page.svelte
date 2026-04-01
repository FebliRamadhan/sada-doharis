<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { handleCallback, exchangeCode, fetchUserInfo } from '../../lib/sso';
  import { setSession } from '../../lib/auth.store';

  let error = '';

  onMount(async () => {
    try {
      // Langkah 2: Baca & validasi callback params
      const { code } = handleCallback();

      // Langkah 3: Tukar code dengan token
      const tokens = await exchangeCode(code);

      // Langkah 4: Ambil profil user
      const userInfo = await fetchUserInfo(tokens.access_token);

      // Simpan ke store
      setSession(tokens, userInfo);

      // Langkah 5: Redirect ke halaman tujuan
      const returnPath = sessionStorage.getItem('sso_return_path') ?? '/dashboard';
      sessionStorage.removeItem('sso_return_path');
      goto(returnPath, { replaceState: true });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Terjadi kesalahan';
    }
  });
</script>

{#if error}
  <div class="error">
    <h2>Login Gagal</h2>
    <p>{error}</p>
    <a href="/login">Coba Lagi</a>
  </div>
{:else}
  <div class="loading">Memproses login...</div>
{/if}

<style>
  .loading, .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4rem;
    text-align: center;
  }
  .error h2 { color: #c0392b; }
  .error a {
    padding: 0.5rem 1.5rem;
    background: #005598;
    color: #fff;
    border-radius: 6px;
    text-decoration: none;
    margin-top: 1rem;
  }
</style>
