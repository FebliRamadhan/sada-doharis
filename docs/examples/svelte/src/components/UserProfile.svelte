<script lang="ts">
  import { user, logout } from '../lib/auth.store';
</script>

{#if $user}
  <div class="user-profile">
    <div class="avatar">{$user.name.charAt(0).toUpperCase()}</div>

    <div class="info">
      <span class="name">{$user.name}</span>
      <span class="email">{$user.email}</span>
    </div>

    <button class="logout-btn" on:click={logout}>Keluar</button>
  </div>
{/if}

<style>
  .user-profile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .avatar {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: #005598;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .info {
    display: flex;
    flex-direction: column;
  }
  .name  { font-weight: 600; }
  .email { font-size: 0.85rem; color: #666; }
  .logout-btn {
    margin-left: auto;
    padding: 0.4rem 0.9rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    font-size: 0.85rem;
  }
</style>
