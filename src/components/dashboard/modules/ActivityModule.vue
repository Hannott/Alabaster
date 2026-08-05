<script setup lang="ts">
import ActivityList from '@/components/ActivityList.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { useDashboardModule } from '@/dashboard/context'

const { isSettingsOpen } = useDashboardModule('activity')
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <ActivityList variant="card" />
  </AppDashboardModule>
</template>
