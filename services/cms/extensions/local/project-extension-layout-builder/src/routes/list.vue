<template>
  <private-view title="Layout Builder">
    <template #title-outer:prepend>
      <v-button class="header-icon" rounded icon secondary disabled>
        <v-icon name="dashboard_customize" />
      </v-button>
    </template>

    <template #actions>
      <v-button @click="$router.push('/layout-builder/new')">
        <v-icon name="add" left />
        New Layout
      </v-button>
    </template>

    <div class="layout-list">
      <v-progress-circular v-if="loading" indeterminate />
      <v-info v-else-if="!layouts.length" icon="widgets" title="No layouts yet">
        Create your first widget layout
      </v-info>
      <div v-else class="layouts-grid">
        <div
          v-for="layout in layouts"
          :key="layout.id"
          class="layout-card"
          @click="$router.push(`/layout-builder/${layout.id}`)"
        >
          <v-icon name="widgets" large />
          <div class="layout-info">
            <div class="layout-name">{{ layout.name || 'Untitled' }}</div>
            <div class="layout-meta">{{ formatDate(layout.date_updated || layout.date_created) }}</div>
          </div>
        </div>
      </div>
    </div>
  </private-view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';

interface Layout {
  id: string;
  name: string;
  date_created: string;
  date_updated: string;
}

const router = useRouter();
const api = useApi();

const loading = ref(true);
const layouts = ref<Layout[]>([]);

function formatDate(date: string | null): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function fetchLayouts() {
  try {
    const { data } = await api.get('/items/calculator_layouts', {
      params: { fields: ['id', 'name', 'date_created', 'date_updated'], sort: ['-date_updated'] },
    });
    layouts.value = data.data ?? [];
  } catch {
    layouts.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(fetchLayouts);
</script>

<style scoped>
.layout-list {
  padding: 24px;
}

.layouts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.layout-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--theme--background);
  border: 1px solid var(--theme--border-color-subdued);
  border-radius: var(--theme--border-radius);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.layout-card:hover {
  border-color: var(--theme--primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.layout-info {
  min-width: 0;
}

.layout-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--theme--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layout-meta {
  font-size: 12px;
  color: var(--theme--foreground-subdued);
  margin-top: 2px;
}
</style>
