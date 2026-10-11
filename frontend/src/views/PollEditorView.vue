<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDemoStore, type PollKind } from '../stores/demo'

const router = useRouter()
const store = useDemoStore()
const kind = ref<PollKind>('vote')
const conferenceId = ref(store.conferences.find((item) => item.status === 'LIVE')?.id || store.conferences[0]?.id || '')
const question = ref('')
const multiple = ref(false)
const options = ref(['За утверждение', 'Против утверждения', 'Воздержался'])
const error = ref('')
const busy = ref(false)
onMounted(async () => {
  try { await store.loadConferences(); if (!conferenceId.value) conferenceId.value = store.conferences.find((item) => item.status === 'LIVE' || item.status === 'SCHEDULED')?.id || '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить встречи' }
})
async function save() {
  const values = options.value.map((value) => value.trim()).filter(Boolean)
  error.value = ''
  if (!conferenceId.value) { error.value = 'Сначала создайте конференцию'; return }
  if (!question.value.trim()) { error.value = 'Укажите вопрос'; return }
  if (values.length < 2) { error.value = 'Добавьте не менее двух вариантов ответа'; return }
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) { error.value = 'Варианты ответа должны различаться'; return }
  busy.value = true
  try {
    await store.createPoll({ conferenceId: conferenceId.value, kind: kind.value, question: question.value.trim(), multiple: kind.value === 'poll' && multiple.value, options: values })
    await router.push('/polls')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось создать опрос' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="page poll-editor-page">
    <header class="page-heading"><div><h1>Создать опрос</h1><p class="muted">Выберите тип опроса и настройте параметры голосования.</p></div></header>
    <h2 class="poll-editor-subtitle">Выберите тип опроса</h2>
    <div class="poll-kind-grid">
      <button type="button" class="choice-card" :class="{ selected: kind === 'poll' }" :aria-pressed="kind === 'poll'" @click="kind = 'poll'"><h3>Обычный опрос</h3><p class="muted mb-0">Быстрый сбор мнений, несколько вариантов, live-результаты.</p></button>
      <button type="button" class="choice-card" :class="{ selected: kind === 'vote' }" :aria-pressed="kind === 'vote'" @click="kind = 'vote'; multiple = false"><h3>Формальное голосование</h3><p class="muted mb-0">Один окончательный бюллетень. Итоги доступны только после закрытия.</p></button>
    </div>
    <div class="surface poll-editor-card">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-5">{{ error }}</v-alert>
      <form @submit.prevent="save">
        <label class="form-label" for="poll-conference">Конференция</label>
        <select id="poll-conference" v-model="conferenceId" class="form-input"><option disabled value="">Выберите встречу</option><option v-for="conference in store.conferences.filter((item) => item.status === 'LIVE' || item.status === 'SCHEDULED')" :key="conference.id" :value="conference.id">{{ conference.title }}</option></select>
        <label class="form-label" for="poll-question">Вопрос</label>
        <textarea id="poll-question" v-model="question" class="form-input poll-question" maxlength="300" placeholder="Например: Утверждение бюджета на Q4 департамента дизайна" />
        <label class="form-label">Варианты</label>
        <div v-for="(_, index) in options" :key="index" class="poll-edit-option"><v-icon :icon="kind === 'vote' || !multiple ? 'mdi-radiobox-blank' : 'mdi-checkbox-blank-outline'" color="primary" size="23" /><input v-model="options[index]" :aria-label="`Вариант ${index + 1}`" maxlength="100" /><button v-if="options.length > 2" type="button" :aria-label="`Удалить вариант ${index + 1}`" @click="options.splice(index, 1)"><v-icon icon="mdi-close" size="18" /></button></div>
        <button v-if="options.length < 10" type="button" class="poll-add-option" @click="options.push('')"><v-icon icon="mdi-plus" size="17" /> Добавить вариант</button>
        <label v-if="kind === 'poll'" class="poll-multiple"><input v-model="multiple" type="checkbox" /> Можно выбрать несколько вариантов</label>
        <div class="poll-editor-rules"><strong>{{ kind === 'vote' ? 'Правила формального голосования' : 'Правила обычного опроса' }}</strong><p class="muted">{{ kind === 'vote' ? 'Допущенные участники фиксируются при открытии. Каждый отправляет один окончательный бюллетень. Итоги доступны только после закрытия.' : 'Участники смогут изменить ответ до закрытия опроса. Результаты обновляются в реальном времени.' }}</p></div>
        <div class="poll-editor-actions"><v-btn variant="outlined" to="/polls">Отмена</v-btn><v-btn type="submit" color="primary" :loading="busy">Создать опрос</v-btn></div>
      </form>
    </div>
  </section>
</template>
