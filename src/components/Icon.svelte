<script lang="ts">
  type Name =
    | 'sidebar'
    | 'detail'
    | 'list'
    | 'folder'
    | 'plus'
    | 'x'
    | 'search'
    | 'dots'
    | 'up'
    | 'down'
    | 'trash'
    | 'archive'
    | 'gear';
  let { name, size = 14 }: { name: Name; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'sidebar'}
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M6 2.5v11" />
  {:else if name === 'detail'}
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M10 2.5v11" />
  {:else if name === 'list'}
    <path d="M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  {:else if name === 'folder'}
    <path d="M1.5 4v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3h-4a1 1 0 0 0-1 1z" />
  {:else if name === 'plus'}
    <path d="M8 3v10M3 8h10" />
  {:else if name === 'x'}
    <path d="M4 4l8 8M12 4l-8 8" />
  {:else if name === 'search'}
    <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
  {:else if name === 'dots'}
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.2" />
  {:else if name === 'up'}
    <path d="M4 10l4-4 4 4" />
  {:else if name === 'down'}
    <path d="M4 6l4 4 4-4" />
  {:else if name === 'trash'}
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
  {:else if name === 'archive'}
    <rect x="1.5" y="2.5" width="13" height="3" rx="0.5" /><path d="M2.5 5.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7M6.5 8.5h3" />
  {:else if name === 'gear'}
    <circle cx="8" cy="8" r="2.2" /><path
      d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
    />
  {/if}
</svg>
