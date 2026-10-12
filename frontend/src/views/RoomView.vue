<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Room, RoomEvent, Track } from 'livekit-client'
import { io, type Socket } from 'socket.io-client'
import { accessToken, ApiError } from '../lib/api'
import { useDemoStore, type Participant, type Poll, type PollKind } from '../stores/demo'
import MediaTile from '../components/MediaTile.vue'

const route = useRoute()
const router = useRouter()
const store = useDemoStore()
const props = defineProps<{ conferenceId?: string }>()
const conferenceId = computed(() => props.conferenceId || String(route.params.id))
const conference = computed(() => store.conferences.find((item) => item.id === conferenceId.value))
const isHost = computed(() => store.roomRole === 'ORGANIZER' || store.roomRole === 'MODERATOR')
const role = computed(() => ({ ORGANIZER: 'Организатор', MODERATOR: 'Модератор', GUEST: 'Гость' })[store.roomRole])
const participants = computed(() => store.roomParticipants.filter((person) => person.status === 'PRESENT'))
const meetingPolls = computed(() => store.polls.filter((poll) => poll.conferenceId === conferenceId.value))
const activePollId = ref('')
const activePoll = computed(() => meetingPolls.value.find((poll) => poll.id === activePollId.value) || meetingPolls.value.find((poll) => poll.status === 'OPEN') || meetingPolls.value[0])
watch(activePoll, (poll) => { if (poll) activePollId.value = poll.id }, { immediate: true })
const activeTab = ref<'participants' | 'polls'>('participants')
const panelVisible = ref(true)
const loading = ref(true)
const connected = ref(false)
const mediaConnected = ref(false)
const mediaRevision = ref(0)
const micOn = ref(false)
const cameraOn = ref(false)
const screenOn = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref<Record<string, number[]>>({})
const confirmEnd = ref(false)
const confirmPollClose = ref('')
const confirmVoteOpen = ref('')
const removePerson = ref<Participant | null>(null)
const createPollOpen = ref(false)
const newPollKind = ref<PollKind>('poll')
const newPollQuestion = ref('')
const newPollMultiple = ref(false)
const newPollOptions = ref(['', ''])
const createPollError = ref('')
const busy = ref(false)
const room = shallowRef<Room | null>(null)
const socket = shallowRef<Socket | null>(null)
const audioRoot = ref<HTMLDivElement | null>(null)
const colors = ['#2862ec', '#64748b', '#10b981', '#f59e0b', '#8b5cf6', '#ec3996']
const screenSharer = computed(() => {
  void mediaRevision.value
  return participants.value.find((person) => {
    const member = person.id === store.participantId ? room.value?.localParticipant : room.value?.remoteParticipants.get(person.id)
    return !!member?.getTrackPublication(Track.Source.ScreenShare)?.videoTrack
  })
})
function initials(name: string) { return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase() }
function roleLabel(person: Participant) { return ({ ORGANIZER: 'Организатор', MODERATOR: 'Модератор', GUEST: 'Гость' })[person.role] }
function isSelf(person: Participant) { return person.id === store.participantId }
function microphoneEnabled(person: Participant) {
  void mediaRevision.value
  if (isSelf(person)) return micOn.value
  const publication = room.value?.remoteParticipants.get(person.id)?.getTrackPublication(Track.Source.Microphone)
  return !!publication && !publication.isMuted
}
function percentage(poll: Poll, index: number) { return Math.round((poll.answers[index] || 0) / Math.max(1, poll.respondents) * 100) }
async function reload() {
  try { await store.loadState(conferenceId.value); await store.loadInteractions(conferenceId.value); error.value = '' }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Связь со встречей потеряна'; connected.value = false
    if (cause instanceof ApiError && [401, 403, 404, 409].includes(cause.status)) {
      room.value?.disconnect(); socket.value?.disconnect(); store.leaveRoom()
    }
  }
}
function connectEvents() {
  const live = io('/events', { transports: ['websocket'], withCredentials: true, auth: { conferenceId: conferenceId.value, accessToken: accessToken() }, reconnection: true })
  socket.value = live
  live.io.on('reconnect_attempt', () => { live.auth = { conferenceId: conferenceId.value, accessToken: accessToken() } })
  live.on('state.snapshot', async (snapshot: { version: number; participants: Participant[]; me: { id: string } }) => {
    store.roomParticipants = snapshot.participants; store.roomVersion = snapshot.version
    if (snapshot.me.id !== store.participantId) { await reload(); return }
    connected.value = true
    await store.loadInteractions(conferenceId.value).catch(() => {})
  })
  const events = ['conference.ended', 'participant.joined', 'participant.left', 'participant.updated', 'participant.removed', 'poll.published', 'poll.results.updated', 'poll.closed', 'vote.opened', 'vote.closed', 'state.updated']
  for (const event of events) live.on(event, async (message: { version: number; data?: { participantId?: string } }) => {
    if (event === 'participant.removed' && message.data?.participantId === store.participantId) { error.value = 'Вы удалены из встречи'; connected.value = false; room.value?.disconnect(); live.disconnect(); store.leaveRoom(); return }
    if (event === 'conference.ended') { error.value = 'Встреча завершена'; connected.value = false; room.value?.disconnect(); live.disconnect(); if (conference.value) conference.value.status = 'ENDED'; store.leaveRoom(); return }
    await reload()
  })
  live.on('disconnect', () => { connected.value = false; if (!error.value) error.value = 'Соединение потеряно. Переподключаемся…' })
  live.on('connect_error', () => { connected.value = false; error.value = 'Не удалось подключить события встречи' })
}
async function connectMedia() {
  const media = await store.mediaToken(conferenceId.value)
  const current = new Room({ adaptiveStream: true, dynacast: true })
  room.value = current
  current.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) { const element = track.attach(); element.autoplay = true; audioRoot.value?.appendChild(element) }
    mediaRevision.value++
  })
  current.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((element) => element.remove()); mediaRevision.value++ })
  const syncLocalMedia = () => {
    micOn.value = current.localParticipant.isMicrophoneEnabled
    cameraOn.value = current.localParticipant.isCameraEnabled
    screenOn.value = current.localParticipant.isScreenShareEnabled
    mediaRevision.value++
  }
  for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted]) current.on(event, syncLocalMedia)
  current.on(RoomEvent.Reconnecting, () => { mediaConnected.value = false })
  current.on(RoomEvent.Reconnected, () => { mediaConnected.value = true; reload() })
  current.on(RoomEvent.Disconnected, () => { mediaConnected.value = false; mediaRevision.value++ })
  await current.connect(media.url, media.token)
  mediaConnected.value = true; mediaRevision.value++
  if (sessionStorage.getItem('pulse-prejoin-mic') === 'true') await current.localParticipant.setMicrophoneEnabled(true, { deviceId: sessionStorage.getItem('pulse-microphone-device') || undefined })
  if (sessionStorage.getItem('pulse-prejoin-camera') === 'true') await current.localParticipant.setCameraEnabled(true, { deviceId: sessionStorage.getItem('pulse-camera-device') || undefined })
  syncLocalMedia()
}
async function reconnect() {
  error.value = ''
  await reload()
  if (!store.participantId || conference.value?.status !== 'LIVE') return
  if (!mediaConnected.value) { room.value?.disconnect(); await connectMedia().catch((cause) => { error.value = cause instanceof Error ? cause.message : 'Медиа недоступно' }) }
  if (!socket.value?.connected) socket.value?.connect()
}
async function toggleMic() { if (!room.value) return; try { await room.value.localParticipant.setMicrophoneEnabled(!micOn.value); micOn.value = room.value.localParticipant.isMicrophoneEnabled; mediaRevision.value++ } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Микрофон недоступен' } }
async function toggleCamera() { if (!room.value) return; try { await room.value.localParticipant.setCameraEnabled(!cameraOn.value); cameraOn.value = room.value.localParticipant.isCameraEnabled; mediaRevision.value++ } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Камера недоступна' } }
async function toggleScreen() { if (!room.value) return; try { await room.value.localParticipant.setScreenShareEnabled(!screenOn.value); screenOn.value = room.value.localParticipant.isScreenShareEnabled; mediaRevision.value++ } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось показать экран' } }
async function mute(person: Participant) { try { await store.mute(conferenceId.value, person.id); notice.value = 'Микрофон участника выключен' } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось выключить микрофон' } }
async function remove() { if (!removePerson.value) return; try { await store.kick(conferenceId.value, removePerson.value.id); notice.value = 'Участник удалён' } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось удалить участника' } finally { removePerson.value = null } }
async function leave() {
  busy.value = true
  try { await store.leaveConference(conferenceId.value) } catch { store.leaveRoom() }
  socket.value?.disconnect(); room.value?.disconnect()
  await router.push(store.userId ? '/conferences' : `/join/${sessionStorage.getItem('pulse-room-slug') || ''}`)
  busy.value = false
}
async function end() {
  busy.value = true
  try { await store.changeConference(conferenceId.value, 'end'); confirmEnd.value = false; socket.value?.disconnect(); room.value?.disconnect(); store.leaveRoom(); await router.push('/conferences') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось завершить встречу' }
  finally { busy.value = false }
}
function minimize() { if (!store.userId) return; store.minimizeRoom(); router.push('/conferences') }
function expand() { router.push(`/conference/${conferenceId.value}`) }
async function copyLink() { if (conference.value?.slug) try { await navigator.clipboard.writeText(`${window.location.origin}/join/${conference.value.slug}`); notice.value = 'Ссылка скопирована' } catch { error.value = 'Не удалось скопировать ссылку' } }
function toggleOption(poll: Poll, index: number) { const current = selected.value[poll.id] || store.responses[poll.id] || []; selected.value[poll.id] = poll.multiple ? current.includes(index) ? current.filter((value) => value !== index) : [...current, index] : [index] }
async function submitAnswer(poll: Poll) {
  busy.value = true
  try { await store.answer(poll.id, selected.value[poll.id] || []); selected.value[poll.id] = []; notice.value = poll.kind === 'vote' ? 'Бюллетень принят' : 'Ответ сохранён' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось отправить ответ' }
  finally { busy.value = false }
}
async function openPoll() { if (!confirmVoteOpen.value) return; busy.value = true; try { await store.publishPoll(confirmVoteOpen.value); confirmVoteOpen.value = ''; notice.value = 'Опрос открыт' } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось открыть опрос' } finally { busy.value = false } }
async function closePoll() { if (!confirmPollClose.value) return; busy.value = true; try { await store.closePoll(confirmPollClose.value); confirmPollClose.value = ''; notice.value = 'Опрос закрыт' } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось закрыть опрос' } finally { busy.value = false } }
function showPollComposer() { newPollKind.value = 'poll'; newPollQuestion.value = ''; newPollMultiple.value = false; newPollOptions.value = ['', '']; createPollError.value = ''; createPollOpen.value = true }
async function createRoomPoll(openNow: boolean) {
  const question = newPollQuestion.value.trim()
  const options = newPollOptions.value.map((value) => value.trim())
  if (!question || options.length < 2 || options.some((value) => !value)) { createPollError.value = 'Укажите вопрос и не менее двух вариантов'; return }
  busy.value = true
  try {
    const kind = newPollKind.value
    const id = await store.createPoll({ conferenceId: conferenceId.value, kind, question, multiple: kind === 'poll' && newPollMultiple.value, options })
    activePollId.value = id; activeTab.value = 'polls'; panelVisible.value = true; createPollOpen.value = false
    if (openNow && kind === 'vote') { await nextTick(); confirmVoteOpen.value = id }
    else if (openNow) await store.publishPoll(id)
    notice.value = openNow && kind === 'poll' ? 'Опрос открыт' : 'Черновик создан'
  } catch (cause) { createPollError.value = cause instanceof Error ? cause.message : 'Не удалось создать опрос' }
  finally { busy.value = false }
}

onMounted(async () => {
  await store.restore()
  await reload()
  loading.value = false
  if (error.value) return
  store.openRoom(conferenceId.value, store.roomRole)
  connectEvents()
  await connectMedia().catch((cause) => { error.value = cause instanceof Error ? cause.message : 'Не удалось подключить медиа' })
})
onUnmounted(() => { socket.value?.disconnect(); room.value?.disconnect() })
</script>

<template>
  <div ref="audioRoot" style="display:none" />
  <div v-if="loading" class="guest-page"><div class="surface guest-state"><h1>Подключаемся ко встрече</h1><p class="muted">Проверяем доступ и загружаем участников.</p></div></div>
  <div v-else-if="!conference || conference.status !== 'LIVE' || !store.participantId" class="guest-page"><div class="surface guest-state"><div class="empty-icon"><v-icon icon="mdi-video-off-outline" /></div><h1>Встреча недоступна</h1><p class="muted">{{ error || 'Она не запущена либо уже завершена.' }}</p><v-btn to="/login" color="primary">Ко входу</v-btn></div></div>
  <section v-else-if="store.roomMinimized" class="room-miniplayer" aria-label="Свернутая конференция"><button type="button" class="miniplayer-preview" @click="expand"><span class="miniplayer-live">● В эфире</span><span class="miniplayer-avatar">{{ initials(store.actor) }}</span><span class="miniplayer-speaker">{{ store.actor }}</span></button><div class="miniplayer-bottom"><div class="miniplayer-details"><strong>{{ conference.title }}</strong><span>{{ participants.length }} участников</span></div><div class="miniplayer-actions"><button type="button" class="miniplayer-action" @click="toggleMic"><v-icon :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'" /></button><button type="button" class="miniplayer-action" @click="expand"><v-icon icon="mdi-arrow-expand" /></button><button type="button" class="miniplayer-action miniplayer-leave" @click="leave"><v-icon icon="mdi-phone-hangup" /></button></div></div></section>
  <div v-else class="room" :class="{ 'room-no-panel': !panelVisible }">
    <header class="room-top"><span class="live-badge">● В эфире</span><h1>{{ conference.title }}</h1><v-spacer /><v-btn v-if="store.userId" icon="mdi-window-minimize" size="small" variant="tonal" aria-label="Свернуть" @click="minimize" /><v-btn icon="mdi-content-copy" size="small" variant="tonal" aria-label="Скопировать ссылку" @click="copyLink" /><v-menu><template #activator="{ props: menuProps }"><v-btn icon="mdi-dots-vertical" size="small" variant="tonal" aria-label="Действия" v-bind="menuProps" /></template><v-list density="compact"><v-list-item title="Покинуть встречу" prepend-icon="mdi-phone-hangup" @click="leave" /><v-list-item v-if="store.canEndRoom" title="Завершить для всех" prepend-icon="mdi-stop-circle-outline" @click="confirmEnd = true" /></v-list></v-menu></header>
    <v-alert v-if="error" type="error" variant="tonal" class="ma-3">{{ error }} <v-btn v-if="!connected || !mediaConnected" size="small" variant="text" @click="reconnect">Повторить подключение</v-btn></v-alert>
    <div class="room-body"><div class="room-stage" :class="{ sharing: screenSharer }"><div v-if="screenSharer" class="share-tile"><MediaTile :room="room" :participant-id="screenSharer.id" :name="screenSharer.displayName" :self="isSelf(screenSharer)" :revision="mediaRevision" screen /></div><div class="video-grid" :class="{ 'share-grid': screenSharer, 'single-video': participants.length === 1 }"><MediaTile v-for="person in participants" :key="person.id" :room="room" :participant-id="person.id" :name="person.displayName" :self="isSelf(person)" :revision="mediaRevision" /></div></div>
      <aside v-if="panelVisible" class="room-panel"><div class="room-panel-header"><div class="room-panel-heading"><h2>{{ activeTab === 'participants' ? `Участники · ${participants.length}` : 'Опросы и голосования' }}</h2><v-btn v-if="activeTab === 'polls' && isHost" color="primary" variant="tonal" size="small" prepend-icon="mdi-plus" @click="showPollComposer">Создать</v-btn></div><p>{{ activeTab === 'participants' ? `Вы — ${role.toLowerCase()}` : activePoll?.status === 'OPEN' && activePoll?.kind === 'vote' ? 'Голосование открыто · итоги скрыты' : activePoll?.status === 'OPEN' ? 'Опрос открыт' : 'Выберите опрос' }}</p></div>
        <div v-if="activeTab === 'participants'" class="room-panel-content participants-content"><div v-for="(person, index) in participants" :key="person.id" class="participant-row"><span class="avatar" :style="{ background: colors[index % colors.length] }">{{ initials(person.displayName) }}</span><span class="participant-info"><strong>{{ person.displayName }}{{ isSelf(person) ? ' (Вы)' : '' }}</strong><small>{{ roleLabel(person) }} · {{ person.mediaConnected ? 'в медиа-комнате' : 'подключается' }}</small></span><button type="button" class="participant-mic" :class="microphoneEnabled(person) ? 'is-on' : 'is-off'" :disabled="!isHost || isSelf(person) || !microphoneEnabled(person)" :aria-label="`Выключить микрофон ${person.displayName}`" @click="mute(person)"><v-icon :icon="microphoneEnabled(person) ? 'mdi-microphone' : 'mdi-microphone-off'" size="18" /></button><v-menu v-if="isHost && !isSelf(person) && person.role !== 'ORGANIZER'"><template #activator="{ props: menuProps }"><v-btn icon="mdi-dots-vertical" size="x-small" variant="text" :aria-label="`Действия с ${person.displayName}`" v-bind="menuProps" /></template><v-list density="compact"><v-list-item title="Удалить" @click="removePerson = person" /></v-list></v-menu></div></div>
        <div v-else class="room-panel-content poll-content"><div v-if="!meetingPolls.length" class="empty-state"><h2>Нет опросов</h2><p class="muted">{{ isHost ? 'Создайте опрос во время встречи.' : 'Опросы появятся здесь.' }}</p></div><template v-else-if="activePoll"><select v-if="meetingPolls.length > 1" v-model="activePollId" class="room-poll-select" aria-label="Выберите опрос"><option v-for="poll in meetingPolls" :key="poll.id" :value="poll.id">{{ poll.question }}</option></select><h3>{{ activePoll.question }}</h3><p class="poll-instruction">{{ activePoll.kind === 'vote' ? 'Один окончательный бюллетень' : activePoll.multiple ? 'Можно выбрать несколько вариантов' : 'Выберите один вариант' }}</p>
          <template v-if="activePoll.status === 'DRAFT'"><div v-for="option in activePoll.options" :key="option" class="poll-option poll-option-disabled">{{ option }}</div><v-btn v-if="isHost" color="primary" block @click="confirmVoteOpen = activePoll.id">Открыть {{ activePoll.kind === 'vote' ? 'голосование' : 'опрос' }}</v-btn></template>
          <template v-else-if="activePoll.status === 'CLOSED'"><div class="poll-summary"><strong>{{ activePoll.kind === 'vote' ? `Допущено: ${activePoll.eligibleCount}` : `Ответили: ${activePoll.respondents}` }}</strong><span v-if="activePoll.kind === 'vote'">Проголосовало: {{ activePoll.respondents }} · Не проголосовало: {{ activePoll.eligibleCount - activePoll.respondents }}</span></div><div v-for="(option, index) in activePoll.options" :key="option" class="result-row"><div><strong>{{ option }}</strong><strong>{{ activePoll.answers[index] }} · {{ percentage(activePoll, index) }}%</strong></div><div class="poll-bar"><span :style="{ width: `${percentage(activePoll, index)}%` }" /></div></div></template>
          <template v-else-if="activePoll.kind === 'vote' && !activePoll.eligible"><div class="poll-blocked"><strong>Вы не допущены</strong><p>Вы вошли после открытия голосования.</p></div></template>
          <template v-else-if="activePoll.kind === 'vote' && activePoll.voted"><div class="poll-success"><strong>Бюллетень принят</strong><p>Повторная отправка недоступна. Итоги появятся после закрытия.</p></div></template>
          <template v-else><div v-for="(option, index) in activePoll.options" :key="option" class="poll-option" :class="{ chosen: (selected[activePoll.id] || store.responses[activePoll.id] || []).includes(index) }" role="button" tabindex="0" @click="toggleOption(activePoll, index)" @keydown.enter="toggleOption(activePoll, index)"><v-icon :icon="(selected[activePoll.id] || store.responses[activePoll.id] || []).includes(index) ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" size="20" class="mr-2" />{{ option }}</div><v-btn color="primary" block :disabled="!(selected[activePoll.id] || []).length" :loading="busy" @click="submitAnswer(activePoll)">{{ activePoll.kind === 'vote' ? 'Отправить бюллетень' : 'Сохранить ответ' }}</v-btn></template>
          <div v-if="activePoll.kind === 'poll' && activePoll.status === 'OPEN'" class="poll-summary mt-4"><strong>Ответили: {{ activePoll.respondents }}</strong><div v-for="(option, index) in activePoll.options" :key="option" class="result-row"><span>{{ option }}</span><strong>{{ activePoll.answers[index] }}</strong></div></div>
          <v-btn v-if="isHost && activePoll.status === 'OPEN'" variant="outlined" color="error" block class="mt-4" @click="confirmPollClose = activePoll.id">Закрыть {{ activePoll.kind === 'vote' ? 'голосование' : 'опрос' }}</v-btn>
        </template></div><div class="room-panel-footer"><v-btn v-if="activeTab === 'participants'" variant="outlined" block @click="activeTab = 'polls'">Опросы</v-btn><v-btn v-else variant="outlined" block @click="activeTab = 'participants'">Участники</v-btn><v-btn variant="outlined" block @click="leave">Выйти</v-btn><v-btn v-if="store.canEndRoom" color="error" block @click="confirmEnd = true">Завершить для всех</v-btn></div></aside>
    </div>
    <footer class="room-toolbar"><div class="toolbar-pill"><div class="tool-button"><v-btn :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'" variant="tonal" :disabled="!mediaConnected" :aria-label="micOn ? 'Выключить микрофон' : 'Включить микрофон'" @click="toggleMic" />Микрофон</div><div class="tool-button"><v-btn :icon="cameraOn ? 'mdi-video' : 'mdi-video-off'" variant="tonal" :disabled="!mediaConnected" :aria-label="cameraOn ? 'Выключить камеру' : 'Включить камеру'" @click="toggleCamera" />Камера</div><div class="tool-button"><v-btn :icon="screenOn ? 'mdi-monitor-off' : 'mdi-monitor-share'" variant="tonal" :disabled="!mediaConnected" aria-label="Демонстрация экрана" @click="toggleScreen" />Экран</div><div class="tool-button"><v-btn icon="mdi-account-group-outline" variant="tonal" aria-label="Участники" @click="activeTab = 'participants'; panelVisible = true" />Участники</div><div class="tool-button"><v-btn icon="mdi-poll" variant="tonal" aria-label="Опросы" @click="activeTab = 'polls'; panelVisible = true" />Опросы</div><div class="tool-button"><v-btn icon="mdi-phone-hangup" color="error" aria-label="Выйти" @click="leave" /></div></div></footer>
    <v-dialog :model-value="!!removePerson" max-width="480" @update:model-value="removePerson = null"><v-card class="room-dialog"><h2>Удалить участника?</h2><p>{{ removePerson?.displayName }} больше не сможет войти с этой сессией.</p><div><v-btn variant="outlined" @click="removePerson = null">Отмена</v-btn><v-btn color="error" :loading="busy" @click="remove">Удалить</v-btn></div></v-card></v-dialog>
    <v-dialog v-model="confirmEnd" max-width="540"><v-card class="room-dialog"><h2>Завершить встречу для всех?</h2><p>Участники покинут комнату и не смогут вернуться по ссылке.</p><div><v-btn variant="outlined" @click="confirmEnd = false">Отмена</v-btn><v-btn color="error" :loading="busy" @click="end">Завершить</v-btn></div></v-card></v-dialog>
    <v-dialog v-model="createPollOpen" max-width="720" scrollable><v-card class="room-poll-create-dialog"><div class="room-poll-create-head"><h2>Создать опрос</h2><v-btn icon="mdi-close" variant="text" @click="createPollOpen = false" /></div><div class="room-poll-create-body"><v-alert v-if="createPollError" type="error" variant="tonal">{{ createPollError }}</v-alert><div class="room-poll-kind"><button class="choice-card" :class="{ selected: newPollKind === 'poll' }" @click="newPollKind = 'poll'">Опрос</button><button class="choice-card" :class="{ selected: newPollKind === 'vote' }" @click="newPollKind = 'vote'">Голосование</button></div><label class="form-label" for="room-poll-question">Вопрос</label><textarea id="room-poll-question" v-model="newPollQuestion" class="form-input" maxlength="300" /><label class="form-label">Варианты</label><div v-for="(_, index) in newPollOptions" :key="index" class="room-poll-option-edit"><input v-model="newPollOptions[index]" :aria-label="`Вариант ${index + 1}`" maxlength="100" /><button v-if="newPollOptions.length > 2" @click="newPollOptions.splice(index, 1)">×</button></div><button v-if="newPollOptions.length < 10" class="poll-add-option" @click="newPollOptions.push('')">Добавить вариант</button><label v-if="newPollKind === 'poll'" class="poll-multiple"><input v-model="newPollMultiple" type="checkbox" /> Можно выбрать несколько вариантов</label></div><div class="room-poll-create-actions"><v-btn variant="outlined" @click="createPollOpen = false">Отмена</v-btn><v-btn variant="outlined" :loading="busy" @click="createRoomPoll(false)">Сохранить черновик</v-btn><v-btn color="primary" :loading="busy" @click="createRoomPoll(true)">Создать и открыть</v-btn></div></v-card></v-dialog>
    <v-dialog :model-value="!!confirmVoteOpen" max-width="600" @update:model-value="confirmVoteOpen = ''"><v-card class="room-dialog"><h2>Открыть {{ store.polls.find((poll) => poll.id === confirmVoteOpen)?.kind === 'vote' ? 'голосование' : 'опрос' }}?</h2><p v-if="store.polls.find((poll) => poll.id === confirmVoteOpen)?.kind === 'vote'">Допуск участников зафиксируется сейчас. Поздно вошедшие не смогут голосовать.</p><div><v-btn variant="outlined" @click="confirmVoteOpen = ''">Отмена</v-btn><v-btn color="primary" :loading="busy" @click="openPoll">Открыть</v-btn></div></v-card></v-dialog>
    <v-dialog :model-value="!!confirmPollClose" max-width="600" @update:model-value="confirmPollClose = ''"><v-card class="room-dialog"><h2>Закрыть опрос?</h2><p>Новые ответы больше не принимаются. Итоги голосования станут доступны всем.</p><div><v-btn variant="outlined" @click="confirmPollClose = ''">Отмена</v-btn><v-btn color="error" :loading="busy" @click="closePoll">Закрыть</v-btn></div></v-card></v-dialog>
    <v-snackbar :model-value="!!notice" @update:model-value="notice = ''" timeout="2200">{{ notice }}</v-snackbar>
  </div>
</template>
