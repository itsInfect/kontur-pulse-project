<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDemoStore } from '../stores/demo'

const store = useDemoStore()
const router = useRouter()
const profileKey = (field: string) => `pulse-profile-${store.userId}-${field}`
type SettingsTab = 'profile' | 'conferences' | 'security'
const tab = ref<SettingsTab>('conferences')
const tabs: { id: SettingsTab; label: string }[] = [{ id: 'profile', label: 'Профиль' }, { id: 'conferences', label: 'Конференции' }, { id: 'security', label: 'Безопасность' }]
const name = ref(store.userName)
const email = ref(store.profileEmail)
const position = ref(localStorage.getItem(profileKey('position')) || '')
const team = ref(localStorage.getItem(profileKey('team')) || '')
const bio = ref(localStorage.getItem(profileKey('bio')) || '')
const profileInitials = computed(() => name.value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'КП')
const allowGuests = ref(localStorage.getItem('pulse-allow-guests') !== 'false')
const saved = ref(false)
const error = ref('')
const settings = [
  { key: 'allowGuests', title: 'Разрешить вход гостям без авторизации', hint: 'Внешние участники смогут заходить по прямой ссылке без обязательной авторизации в Kontur Pulse' },
] as const
const toggles = { allowGuests }

async function save() {
  error.value = ''
  if (!name.value.trim()) { tab.value = 'profile'; error.value = 'Укажите имя, которое увидят участники'; return }
  try { if (name.value.trim() !== store.userName) await store.updateProfile(name.value.trim()) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить профиль'; return }
  position.value = position.value.trim()
  team.value = team.value.trim()
  bio.value = bio.value.trim()
  localStorage.setItem(profileKey('position'), position.value)
  localStorage.setItem(profileKey('team'), team.value)
  localStorage.setItem(profileKey('bio'), bio.value)
  localStorage.setItem('pulse-allow-guests', String(allowGuests.value))
  saved.value = true
}
function cancel() {
  name.value = store.userName
  email.value = store.profileEmail
  position.value = localStorage.getItem(profileKey('position')) || ''
  team.value = localStorage.getItem(profileKey('team')) || ''
  bio.value = localStorage.getItem(profileKey('bio')) || ''
  allowGuests.value = localStorage.getItem('pulse-allow-guests') !== 'false'
  error.value = ''
}
async function signOut() { await store.signOut(); router.push('/login') }
</script>

<template>
  <section class="page settings-page">
    <header class="page-heading"><div><h1>Настройки</h1><p class="muted">Имя профиля сохраняется на сервере, предпочтения устройств и встреч — в этом браузере.</p></div></header>
    <div class="settings-tabs" role="tablist" aria-label="Раздел настроек">
      <button v-for="item in tabs" :key="item.id" type="button" role="tab" :aria-selected="tab === item.id" :class="{ active: tab === item.id }" @click="tab = item.id; error = ''">{{ item.label }}</button>
    </div>
    <div class="surface settings-card">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-5">{{ error }}</v-alert>
      <template v-if="tab === 'conferences'">
        <h2>Параметры конференций по умолчанию</h2>
        <label v-for="item in settings" :key="item.key" class="settings-row"><span><strong>{{ item.title }}</strong><small>{{ item.hint }}</small></span><input v-model="toggles[item.key].value" type="checkbox" class="switch-input" :aria-label="item.title" /></label>
      </template>
      <template v-else-if="tab === 'profile'">
        <div class="settings-profile-hero"><span class="settings-profile-avatar">{{ profileInitials }}</span><div><strong>{{ name.trim() || 'Ваш профиль' }}</strong><span>{{ position || 'Участник Kontur Pulse' }}<template v-if="team"> · {{ team }}</template></span><small>{{ email }}</small></div></div>
        <div class="settings-section-title"><h2>Личная информация</h2><p>Дополните профиль и выберите имя, которое увидят участники встреч.</p></div>
        <div class="settings-form-grid">
          <div class="settings-field settings-field-wide"><label class="form-label" for="settings-name">Отображаемое имя</label><input id="settings-name" v-model="name" class="form-input" maxlength="50" autocomplete="name" /><small>Показывается рядом с вашим видео и в списке участников.</small></div>
          <div class="settings-field settings-field-wide"><label class="form-label" for="settings-email">Контактная почта</label><input id="settings-email" v-model="email" class="form-input" type="email" readonly /><small>Изменение адреса почты пока не поддерживается.</small></div>
          <div class="settings-field"><label class="form-label" for="settings-position">Должность</label><input id="settings-position" v-model="position" class="form-input" maxlength="80" placeholder="Например, продакт-менеджер" /></div>
          <div class="settings-field"><label class="form-label" for="settings-team">Команда или отдел</label><input id="settings-team" v-model="team" class="form-input" maxlength="80" placeholder="Например, команда продукта" /></div>
          <div class="settings-field settings-field-wide"><label class="form-label" for="settings-bio">О себе</label><textarea id="settings-bio" v-model="bio" class="form-input" rows="3" maxlength="240" placeholder="Чем вы занимаетесь и по каким вопросам к вам обращаться" /><small>{{ bio.length }} / 240 символов</small></div>
        </div>
      </template>
      <template v-else>
        <div class="settings-section-title"><h2>Безопасность</h2><p>Сведения о текущем сеансе и параметрах доступа к конференциям.</p></div>
        <div class="settings-security-session"><span class="settings-security-icon"><v-icon icon="mdi-laptop" size="23" /></span><div><strong>Текущий сеанс</strong><span>Этот браузер · {{ store.profileEmail }}</span><small>Вы можете завершить сеанс, когда закончите работу на этом устройстве.</small></div><span class="settings-active-badge">Активен</span></div>
        <v-btn variant="outlined" prepend-icon="mdi-logout" class="settings-session-exit" @click="signOut">Выйти из аккаунта</v-btn>
        <div class="settings-section-title settings-section-divider"><h2>Доступ к встречам</h2><p>Текущие параметры по умолчанию для новых конференций.</p></div>
        <div class="settings-security-list">
          <div><span class="settings-security-list-icon"><v-icon :icon="allowGuests ? 'mdi-link-variant' : 'mdi-lock-outline'" size="19" /></span><span><strong>Вход гостей по ссылке</strong><small>{{ allowGuests ? 'Разрешён в настройках по умолчанию' : 'Выключен в настройках по умолчанию' }}</small></span><em>{{ allowGuests ? 'Разрешён' : 'Выключен' }}</em></div>
          <div><span class="settings-security-list-icon"><v-icon icon="mdi-poll" size="19" /></span><span><strong>Формальные голосования</strong><small>Итоги становятся доступны после закрытия голосования.</small></span></div>
        </div>
        <button type="button" class="settings-text-link" @click="tab = 'conferences'"><v-icon icon="mdi-arrow-right" size="17" /> Настроить доступ к конференциям</button>
        <p class="settings-security-note"><v-icon icon="mdi-information-outline" size="18" /> Камеру и микрофон можно выбрать перед входом во встречу. Для смены пароля используйте восстановление доступа на странице входа.</p>
      </template>
      <div class="settings-actions"><v-btn color="primary" @click="save">Сохранить изменения</v-btn><v-btn variant="outlined" @click="cancel">Отменить</v-btn></div>
    </div>
    <v-snackbar v-model="saved" color="success" timeout="2200">Настройки сохранены</v-snackbar>
  </section>
</template>
