<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDemoStore, type Conference } from '../stores/demo'

const route = useRoute()
const router = useRouter()
const store = useDemoStore()
const conference = ref<Conference | null>(null)
const loading = ref(true)
const displayName = ref(store.userName || store.guestName || '')
const micOn = ref(false)
const cameraOn = ref(false)
const camera = ref('')
const microphone = ref('')
const cameras = ref<{ title: string; value: string }[]>([])
const microphones = ref<{ title: string; value: string }[]>([])
const preview = ref<HTMLVideoElement | null>(null)
const error = ref('')
const joining = ref(false)
let stream: MediaStream | null = null
let previewRun = 0

const state = computed(() => {
  if (loading.value) return { icon: 'mdi-loading', title: 'Загружаем встречу', description: 'Подождите немного.' }
  if (!conference.value) return { icon: 'mdi-link-variant-off', title: 'Не удалось найти встречу', description: error.value || 'Проверьте ссылку и попросите организатора прислать новую.' }
  if (conference.value.status === 'CANCELLED') return { icon: 'mdi-calendar-remove-outline', title: 'Встреча отменена', description: 'Организатор отменил эту встречу.' }
  if (conference.value.status === 'ENDED') return { icon: 'mdi-check-circle-outline', title: 'Встреча завершена', description: 'Эта встреча уже закончилась.' }
  if (!conference.value.allowGuests && !store.userId) return { icon: 'mdi-lock-outline', title: 'Вход по ссылке закрыт', description: 'Организатор отключил вход гостей.' }
  if (conference.value.status === 'SCHEDULED') return { icon: 'mdi-clock-outline', title: 'Встреча ещё не началась', description: 'Подождите, пока организатор запустит конференцию.' }
  return null
})

async function load() {
  loading.value = true; error.value = ''
  try { conference.value = await store.invitation(String(route.params.slug)); store.upsertConference(conference.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить встречу'; conference.value = null }
  finally { loading.value = false }
}

async function updatePreview() {
  const run = ++previewRun
  stream?.getTracks().forEach((track) => track.stop()); stream = null
  if (!cameraOn.value && !micOn.value) { if (preview.value) preview.value.srcObject = null; return }
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: cameraOn.value ? camera.value ? { deviceId: { ideal: camera.value } } : true : false,
      audio: micOn.value ? microphone.value ? { deviceId: { ideal: microphone.value } } : true : false,
    })
    if (run !== previewRun) { nextStream.getTracks().forEach((track) => track.stop()); return }
    stream = nextStream
    await nextTick()
    if (preview.value) { preview.value.srcObject = stream; await preview.value.play().catch(() => {}) }
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameras.value = devices.filter((item) => item.kind === 'videoinput').map((item, index) => ({ title: item.label || `Камера ${index + 1}`, value: item.deviceId }))
    microphones.value = devices.filter((item) => item.kind === 'audioinput').map((item, index) => ({ title: item.label || `Микрофон ${index + 1}`, value: item.deviceId }))
    error.value = ''
  } catch (cause) {
    if (run !== previewRun) return
    cameraOn.value = false; micOn.value = false
    error.value = cause instanceof Error ? `Не удалось открыть устройство: ${cause.message}` : 'Нет доступа к устройствам'
  }
}

async function join() {
  if (!displayName.value.trim()) { error.value = 'Укажите имя, которое увидят участники'; return }
  if (!conference.value || conference.value.status !== 'LIVE') return
  joining.value = true; error.value = ''
  try {
    sessionStorage.setItem('pulse-prejoin-mic', String(micOn.value))
    sessionStorage.setItem('pulse-prejoin-camera', String(cameraOn.value))
    if (camera.value) sessionStorage.setItem('pulse-camera-device', camera.value)
    if (microphone.value) sessionStorage.setItem('pulse-microphone-device', microphone.value)
    await store.join(conference.value.slug, displayName.value.trim())
    stream?.getTracks().forEach((track) => track.stop())
    await router.push(`/conference/${conference.value.id}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось войти во встречу' }
  finally { joining.value = false }
}

watch([cameraOn, micOn, camera, microphone], updatePreview)
onMounted(async () => { await store.restore(); if (store.userId) displayName.value = store.userName; await load() })
onUnmounted(() => { previewRun++; stream?.getTracks().forEach((track) => track.stop()) })
</script>

<template>
  <div class="guest-page">
    <router-link class="brand" to="/conferences"><span class="brand-mark"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9v6m3-9v12m3-8v4m3-11v18m3-13v8m3-11v14m3-10v6" /></svg></span><span><strong>Kontur Pulse</strong><small>Видеоконференции</small></span></router-link>
    <div v-if="state" class="surface guest-state"><div class="empty-icon"><v-icon :icon="state.icon" size="27" /></div><h1>{{ state.title }}</h1><p class="muted mb-6">{{ state.description }}</p><v-btn v-if="conference?.status === 'SCHEDULED'" color="primary" @click="load">Проверить ещё раз</v-btn><v-btn v-else variant="outlined" to="/login">Ко входу</v-btn></div>
    <main v-else-if="conference" class="guest-content">
      <p class="eyebrow">ВЫ ПРИГЛАШЕНЫ НА ВСТРЕЧУ</p>
      <h1 class="mb-7">{{ conference.title }}</h1>
      <div class="prejoin-grid">
        <div>
          <div class="prejoin-preview"><video v-show="cameraOn" ref="preview" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover" /><span v-if="!cameraOn" class="video-initials">{{ displayName.trim().split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'ВЫ' }}</span><span class="preview-label">{{ cameraOn ? 'Предпросмотр камеры' : 'Камера выключена' }}</span></div>
          <div class="prejoin-controls"><v-btn :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'" :color="micOn ? 'primary' : 'error'" variant="tonal" :aria-label="micOn ? 'Выключить микрофон' : 'Включить микрофон'" @click="micOn = !micOn" /><v-btn :icon="cameraOn ? 'mdi-video' : 'mdi-video-off'" :color="cameraOn ? 'primary' : 'error'" variant="tonal" :aria-label="cameraOn ? 'Выключить камеру' : 'Включить камеру'" @click="cameraOn = !cameraOn" /></div>
        </div>
        <div class="surface surface-pad">
          <h2 class="section-title" style="font-size:19px">Перед входом во встречу</h2>
          <p class="muted mb-6">Проверьте, как вас увидят и услышат другие участники.</p>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
          <form @submit.prevent="join">
            <v-text-field v-model="displayName" :label="store.userId ? 'Ваше имя в профиле' : 'Как вас представить?'" :readonly="!!store.userId" placeholder="Имя Фамилия" variant="outlined" density="comfortable" maxlength="50" class="mb-1" />
            <v-select v-model="camera" label="Камера" :items="cameras" item-title="title" item-value="value" placeholder="По умолчанию" variant="outlined" density="comfortable" class="mb-1" />
            <v-select v-model="microphone" label="Микрофон" :items="microphones" item-title="title" item-value="value" placeholder="По умолчанию" variant="outlined" density="comfortable" class="mb-1" />
            <div class="muted mb-5">Микрофон {{ micOn ? 'включён' : 'выключен' }} · камера {{ cameraOn ? 'включена' : 'выключена' }}</div>
            <v-btn type="submit" color="primary" block size="large" :loading="joining">Присоединиться</v-btn>
            <v-btn to="/login" variant="text" block class="mt-2">Вернуться</v-btn>
          </form>
        </div>
      </div>
    </main>
  </div>
</template>
