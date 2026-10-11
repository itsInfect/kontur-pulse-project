<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDemoStore } from '../stores/demo'
import { api, json } from '../lib/api'

const props = withDefaults(defineProps<{ mode?: string }>(), { mode: 'login' })
const route = useRoute()
const router = useRouter()
const store = useDemoStore()
const email = ref('')
const password = ref('')
const confirmation = ref('')
const name = ref('')
const accepted = ref(false)
const error = ref('')
const sent = ref(false)
const busy = ref(false)
const resendReady = ref(true)
const verified = ref(false)
const registeredEmail = computed(() => sessionStorage.getItem('pulse-register-email') || email.value)
watch(() => props.mode, () => { error.value = ''; sent.value = false; password.value = ''; confirmation.value = '' })
watch(() => [props.mode, route.query.token], async () => {
  if (props.mode !== 'verify' || typeof route.query.token !== 'string') return
  busy.value = true
  try { await api('/auth/verify-email', { method: 'POST', body: json({ token: route.query.token }) }, false); verified.value = true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось подтвердить почту' }
  finally { busy.value = false }
}, { immediate: true })
const title = computed(() => ({ login: 'Войти в аккаунт', register: 'Создать аккаунт', forgot: sent.value ? 'Проверьте электронную почту' : 'Сбросить пароль', verify: verified.value ? 'Электронная почта подтверждена' : 'Подтвердите электронную почту', reset: sent.value ? 'Пароль успешно изменён' : 'Придумайте новый пароль' })[props.mode] || 'Войти в аккаунт')
const description = computed(() => ({ login: 'Введите данные для доступа к личному кабинету.', register: 'Введите данные для доступа к личному кабинету.', forgot: sent.value ? 'Если для этого адреса есть аккаунт, мы отправили инструкцию.' : 'Укажите электронную почту для восстановления доступа.', verify: verified.value ? 'Аккаунт готов к работе.' : `Письмо отправлено на ${registeredEmail.value}.`, reset: sent.value ? 'Теперь можно войти с новым паролем.' : 'Используйте надёжный пароль для своего аккаунта.' })[props.mode] || '')
async function submit() {
  error.value = ''
  if (props.mode !== 'reset' && !email.value.includes('@')) { error.value = 'Введите корректный адрес почты'; return }
  if (props.mode === 'login' && !password.value) { error.value = 'Введите пароль'; return }
  if (props.mode === 'register' || props.mode === 'reset') {
    if (password.value.length < 8 || !/[a-zа-я]/i.test(password.value) || !/\d/.test(password.value)) { error.value = 'Не менее 8 символов, буквы и цифры'; return }
    if (password.value !== confirmation.value) { error.value = 'Пароли не совпадают'; return }
  }
  if (props.mode === 'register' && (!name.value.trim() || !accepted.value)) { error.value = 'Укажите имя и примите условия'; return }
  busy.value = true
  try {
    if (props.mode === 'login') { await store.signIn(email.value, password.value); await router.push(typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/conferences') }
    if (props.mode === 'register') {
      await api('/auth/register', { method: 'POST', body: json({ email: email.value, name: name.value, password: password.value }) }, false)
      sessionStorage.setItem('pulse-register-email', email.value)
      await router.push('/verify-email')
    }
    if (props.mode === 'forgot') { await api('/auth/password/forgot', { method: 'POST', body: json({ email: email.value }) }, false); sent.value = true }
    if (props.mode === 'reset') {
      if (typeof route.query.token !== 'string') throw new Error('Откройте ссылку из письма для сброса пароля')
      await api('/auth/password/reset', { method: 'POST', body: json({ token: route.query.token, password: password.value }) }, false)
      sent.value = true
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось выполнить запрос' }
  finally { busy.value = false }
}
async function resend() {
  if (!registeredEmail.value || !resendReady.value) return
  busy.value = true
  try { await api('/auth/verify-email/resend', { method: 'POST', body: json({ email: registeredEmail.value }) }, false); resendReady.value = false; window.setTimeout(() => { resendReady.value = true }, 45000) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось отправить письмо' }
  finally { busy.value = false }
}
function continueToAccount() { router.push('/login') }
</script>

<template>
  <div class="auth-layout">
    <section class="auth-side"><div class="auth-side-inner"><router-link class="brand" to="/conferences"><span class="brand-mark"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9v6m3-9v12m3-8v4m3-11v18m3-13v8m3-11v14m3-10v6" /></svg></span><span><strong>Kontur Pulse</strong><small>Видеоконференции</small></span></router-link><h1>Платформа для совместных встреч</h1><div class="auth-feature"><v-icon icon="mdi-shield-check-outline" size="22" /><span><strong>Доступ по приглашению</strong><br><span class="muted">Организатор управляет встречей, участниками и правами модераторов.</span></span></div><div class="auth-feature"><v-icon icon="mdi-monitor-play" size="22" /><span><strong>Видео и демонстрация экрана</strong><br><span class="muted">Общайтесь с участниками и показывайте материалы прямо в браузере.</span></span></div><div class="auth-feature"><v-icon icon="mdi-chart-scatter-plot" size="22" /><span><strong>Интерактивные опросы</strong><br><span class="muted">Проводите голосования в реальном времени. Итоги видны только после закрытия голосования.</span></span></div></div></section>
    <main class="auth-main"><div class="surface auth-card" :class="{ 'auth-register-card': mode === 'register' }"><div class="auth-mobile-brand"><span class="brand-mark"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9v6m3-9v12m3-8v4m3-11v18m3-13v8m3-11v14m3-10v6" /></svg></span><strong>Kontur Pulse</strong></div><h2>{{ title }}</h2><p class="muted">{{ description }}</p><v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
      <template v-if="mode === 'verify'"><div class="auth-callout" :class="{ success: verified }"><strong>{{ verified ? 'Подтверждение выполнено' : 'Письмо с подтверждением' }}</strong><p>{{ verified ? 'Теперь войдите в аккаунт.' : 'Перейдите по ссылке в письме. Если письма нет, проверьте папку «Спам».' }}</p></div><v-btn v-if="verified" color="primary" block @click="continueToAccount">Перейти ко входу</v-btn><template v-else><v-btn block :disabled="!resendReady || busy" @click="resend">{{ resendReady ? 'Отправить письмо повторно' : 'Повторить через 45 секунд' }}</v-btn><v-btn variant="outlined" block class="mt-4" to="/register">Изменить адрес</v-btn><p class="auth-email-note">{{ registeredEmail }}</p></template></template>
      <template v-else-if="mode === 'forgot' && sent"><div class="auth-callout"><strong>Инструкция отправлена</strong><p>Проверьте входящие и папку «Спам». Сообщение может прийти через несколько минут.</p></div><v-btn variant="outlined" block class="mt-4" to="/login">Вернуться ко входу</v-btn></template>
      <template v-else-if="mode === 'reset' && sent"><div class="auth-callout success"><strong>Доступ восстановлен</strong><p>Используйте новый пароль при следующем входе.</p></div><v-btn color="primary" block to="/login">Перейти ко входу</v-btn></template>
      <form v-else @submit.prevent="submit"><template v-if="mode === 'register'"><label class="form-label" for="auth-name">Имя</label><input id="auth-name" v-model="name" class="form-input" autocomplete="name" placeholder="Константин Александров" /></template><label v-if="mode !== 'reset'" class="form-label" for="auth-email">Электронная почта</label><input v-if="mode !== 'reset'" id="auth-email" v-model="email" class="form-input" type="email" autocomplete="email" placeholder="you@example.com" /><label v-if="mode !== 'forgot'" class="form-label" for="auth-password">{{ mode === 'reset' ? 'Новый пароль' : 'Пароль' }}</label><input v-if="mode !== 'forgot'" id="auth-password" v-model="password" class="form-input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="••••••••••••" /><p v-if="mode === 'register'" class="auth-hint">Не менее 8 символов, буквы и цифры</p><p v-if="mode === 'reset'" class="auth-valid-hint">✓ Не менее 8 символов<br>✓ Есть буквы и цифры</p><template v-if="mode === 'register' || mode === 'reset'"><label class="form-label" for="auth-confirm">{{ mode === 'reset' ? 'Повторите новый пароль' : 'Повторите пароль' }}</label><input id="auth-confirm" v-model="confirmation" class="form-input" type="password" autocomplete="new-password" placeholder="••••••••••••" /></template><label v-if="mode === 'register'" class="auth-agreement"><input v-model="accepted" type="checkbox" />Принимаю условия использования и согласен на обработку персональных данных</label><router-link v-if="mode === 'login'" class="auth-forgot" to="/forgot-password">Забыли пароль?</router-link><v-btn type="submit" color="primary" :loading="busy" block>{{ mode === 'login' ? 'Войти' : mode === 'register' ? 'Зарегистрироваться' : mode === 'forgot' ? 'Отправить инструкцию' : 'Сохранить новый пароль' }}</v-btn></form>
      <div v-if="mode === 'login'" class="auth-bottom-link">Нет аккаунта? <router-link to="/register">Зарегистрироваться</router-link></div><div v-else-if="mode === 'register'" class="auth-bottom-link"><router-link to="/login">Уже есть аккаунт? Войти</router-link></div><v-btn v-else-if="mode === 'forgot' && !sent" variant="outlined" block class="mt-4" to="/login">Вернуться ко входу</v-btn>
    </div></main>
  </div>
</template>
