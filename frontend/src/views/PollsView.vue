<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDemoStore, type Poll } from '../stores/demo'

const store = useDemoStore()
const filter = ref<'all' | 'poll' | 'vote'>('all')
const search = ref('')
const error = ref('')
const busy = ref(false)
const confirmClose = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const selected = computed(() => store.polls.find((poll) => poll.id === selectedId.value) || null)
const rows = computed(() => store.polls.filter((poll) => (filter.value === 'all' || poll.kind === filter.value) && poll.question.toLowerCase().includes(search.value.toLowerCase())))
const status = { DRAFT: 'Черновик', OPEN: 'Активен', CLOSED: 'Завершён' }
const totalAnswers = computed(() => store.polls.filter((poll) => poll.kind === 'poll').reduce((sum, poll) => sum + poll.respondents, 0))
const activeCount = computed(() => store.polls.filter((poll) => poll.status === 'OPEN').length)
const closedCount = computed(() => store.polls.filter((poll) => poll.status === 'CLOSED').length)
function conferenceTitle(id: string) { return store.conferences.find((item) => item.id === id)?.title || 'Встреча' }
function isLive(poll: Poll) { return store.conferences.find((item) => item.id === poll.conferenceId)?.status === 'LIVE' }
async function open(poll: Poll) {
  busy.value = true; error.value = ''
  try { await store.publishPoll(poll.id) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось открыть опрос' }
  finally { busy.value = false }
}
async function close() {
  if (!confirmClose.value) return
  busy.value = true; error.value = ''
  try { await store.closePoll(confirmClose.value); confirmClose.value = null }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось закрыть опрос' }
  finally { busy.value = false }
}
onMounted(() => { store.loadAllInteractions().catch((cause) => { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить опросы' }) })
</script>

<template>
  <section class="page">
    <header class="page-heading"><div><h1>Центр опросов</h1><p class="muted">Опросы и голосования ваших встреч.</p></div><v-btn color="primary" to="/polls/create">Создать опрос</v-btn></header>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-5">{{ error }}</v-alert>
    <div class="surface poll-stats"><div class="poll-stats-title">СТАТИСТИКА</div><div class="poll-stats-values"><div><strong>{{ totalAnswers }}</strong><small>Ответов на опросы</small></div><div><strong>{{ activeCount }}</strong><small>Открытых</small></div><div><strong>{{ closedCount }}</strong><small>Завершённых</small></div></div></div>
    <div class="poll-tools"><div class="poll-filters" role="tablist" aria-label="Тип опроса"><button v-for="item in [{ value: 'all', label: 'Все типы' }, { value: 'poll', label: 'Опрос' }, { value: 'vote', label: 'Голосование' }] as const" :key="item.value" type="button" role="tab" class="poll-filter" :class="{ active: filter === item.value }" :aria-selected="filter === item.value" @click="filter = item.value">{{ item.label }}</button></div><label class="poll-search"><v-icon icon="mdi-magnify" size="20" /><input v-model="search" type="search" aria-label="Поиск опроса" placeholder="Поиск по вопросу..." /></label></div>
    <div v-if="rows.length" class="surface table-scroll polls-table">
      <table class="list-table"><thead><tr><th>ВОПРОС</th><th>ВСТРЕЧА</th><th>ТИП</th><th>УЧАСТИЕ</th><th>СТАТУС</th><th>ДЕЙСТВИЯ</th></tr></thead><tbody>
        <tr v-for="poll in rows" :key="poll.id"><td><div class="font-weight-bold table-title">{{ poll.question }}</div></td><td>{{ conferenceTitle(poll.conferenceId) }}</td><td>{{ poll.kind === 'vote' ? 'Голосование' : 'Опрос' }}</td><td>{{ poll.kind === 'vote' ? poll.status === 'CLOSED' ? `${poll.respondents} из ${poll.eligibleCount} проголосовало` : 'Итоги после закрытия' : `${poll.respondents} ответили` }}</td><td><v-chip size="small" :color="poll.status === 'OPEN' ? 'success' : poll.status === 'DRAFT' ? 'primary' : 'secondary'" variant="tonal">{{ status[poll.status] }}</v-chip></td><td class="text-no-wrap"><v-btn v-if="poll.status === 'DRAFT' && isLive(poll)" size="small" color="primary" variant="tonal" :loading="busy" @click="open(poll)">Открыть</v-btn><v-btn v-if="poll.status === 'OPEN'" size="small" variant="outlined" color="error" @click="confirmClose = poll.id">Закрыть</v-btn><v-btn v-if="poll.status === 'CLOSED' || poll.kind === 'poll' && poll.status === 'OPEN'" size="small" variant="text" @click="selectedId = poll.id">Результаты</v-btn></td></tr>
      </tbody></table>
    </div>
    <div v-if="rows.length" class="mobile-polls"><div v-for="poll in rows" :key="poll.id" class="surface mobile-meeting"><v-chip size="x-small" :color="poll.status === 'OPEN' ? 'success' : 'secondary'" variant="tonal">{{ status[poll.status] }}</v-chip><h3>{{ poll.question }}</h3><p class="muted">{{ conferenceTitle(poll.conferenceId) }}</p><div class="card-actions"><v-btn v-if="poll.status === 'DRAFT' && isLive(poll)" size="small" color="primary" @click="open(poll)">Открыть</v-btn><v-btn v-if="poll.status === 'OPEN'" size="small" variant="outlined" color="error" @click="confirmClose = poll.id">Закрыть</v-btn><v-btn v-if="poll.status === 'CLOSED' || poll.kind === 'poll' && poll.status === 'OPEN'" size="small" variant="outlined" @click="selectedId = poll.id">Результаты</v-btn></div></div></div>
    <div v-else class="surface empty-state"><div class="empty-icon"><v-icon icon="mdi-poll" size="28" /></div><h2>Здесь пока пусто</h2><p class="muted">Создайте первый опрос или измените фильтр.</p><v-btn color="primary" to="/polls/create">Создать опрос</v-btn></div>
    <v-dialog :model-value="!!confirmClose" max-width="430" @update:model-value="confirmClose = null"><v-card class="pa-5"><h2 class="text-h6 mb-2">Закрыть опрос?</h2><p class="dialog-copy">После закрытия ответы больше не принимаются.</p><div class="d-flex justify-end ga-2 mt-4"><v-btn variant="text" @click="confirmClose = null">Отмена</v-btn><v-btn color="error" :loading="busy" @click="close">Закрыть</v-btn></div></v-card></v-dialog>
    <v-dialog :model-value="!!selected" max-width="520" @update:model-value="selectedId = null"><v-card v-if="selected" class="pa-6"><div class="card-kicker mb-2">{{ selected.kind === 'vote' ? 'ИТОГИ ГОЛОСОВАНИЯ' : 'РЕЗУЛЬТАТЫ ОПРОСА' }}</div><h2 class="text-h6 mb-3">{{ selected.question }}</h2><div class="muted mb-4">{{ selected.kind === 'vote' ? `Допущено: ${selected.eligibleCount} · Проголосовало: ${selected.respondents} · Не проголосовало: ${selected.eligibleCount - selected.respondents}` : `Ответили: ${selected.respondents}` }}</div><div v-for="(option, index) in selected.options" :key="option" class="result-row"><div><span>{{ option }}</span><strong>{{ selected.answers[index] }} · {{ Math.round((selected.answers[index] || 0) / Math.max(1, selected.respondents) * 100) }}%</strong></div><div class="poll-bar"><span :style="{ width: `${Math.round((selected.answers[index] || 0) / Math.max(1, selected.respondents) * 100)}%` }" /></div></div><v-btn variant="outlined" block class="mt-5" @click="selectedId = null">Закрыть</v-btn></v-card></v-dialog>
  </section>
</template>
