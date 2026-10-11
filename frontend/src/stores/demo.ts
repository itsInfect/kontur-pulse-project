import { defineStore } from 'pinia'
import { api, json, setAccessToken } from '../lib/api'

export type ConferenceStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
export type PollStatus = 'DRAFT' | 'OPEN' | 'CLOSED'
export type PollKind = 'poll' | 'vote'
export type ParticipantRole = 'ORGANIZER' | 'MODERATOR' | 'GUEST'
export interface Conference { id: string; slug: string; title: string; description: string; startsAt: string; status: ConferenceStatus; allowGuests: boolean }
export interface Participant { id: string; displayName: string; role: ParticipantRole; status: 'PRESENT' | 'LEFT' | 'REMOVED'; mediaConnected: boolean }
export interface Poll { id: string; conferenceId: string; question: string; kind: PollKind; status: PollStatus; multiple: boolean; options: string[]; answers: number[]; respondents: number; eligibleCount: number; eligible: boolean; voted: boolean }
interface User { id: string; email: string; name: string }
interface AuthResult { accessToken: string; user: User }
interface JoinResult { conferenceId: string; participantId: string; role: ParticipantRole }
interface PollResult { answers: number[]; respondents: number }
interface VoteResult { answers: number[]; eligible: number; ballots: number }
interface InteractionPoll { id: string; conferenceId: string; question: string; status: PollStatus; multiple: boolean; options: string[]; results?: PollResult; selected?: number[] }
interface InteractionVote { id: string; conferenceId: string; question: string; status: PollStatus; options: string[]; results?: VoteResult; eligible: boolean; voted: boolean }
interface Interactions { polls: InteractionPoll[]; votes: InteractionVote[] }
interface Snapshot { version: number; conference: { id: string; title: string; status: ConferenceStatus }; me: { id: string; role: ParticipantRole; status: Participant['status']; canEnd: boolean }; participants: Participant[] }

function mapInteractions(data: Interactions): Poll[] {
  return [
    ...data.polls.map((poll): Poll => ({ ...poll, kind: 'poll', answers: poll.results?.answers || poll.options.map(() => 0), respondents: poll.results?.respondents || 0, eligibleCount: 0, eligible: true, voted: false })),
    ...data.votes.map((vote): Poll => ({ ...vote, kind: 'vote', multiple: false, answers: vote.results?.answers || vote.options.map(() => 0), respondents: vote.results?.ballots || 0, eligibleCount: vote.results?.eligible || 0 })),
  ]
}

export const useDemoStore = defineStore('pulse', {
  state: () => ({
    userId: '',
    userName: '',
    profileEmail: '',
    guestName: sessionStorage.getItem('pulse-guest') || '',
    activeRoomId: sessionStorage.getItem('pulse-active-room') || '',
    roomMinimized: sessionStorage.getItem('pulse-room-minimized') === 'true',
    roomRole: (sessionStorage.getItem('pulse-room-role') || 'GUEST') as ParticipantRole,
    participantId: sessionStorage.getItem('pulse-participant-id') || '',
    conferences: [] as Conference[],
    polls: [] as Poll[],
    responses: {} as Record<string, number[]>,
    roomParticipants: [] as Participant[],
    roomVersion: 0,
    canEndRoom: false,
    restored: false,
  }),
  getters: { actor: (state) => state.guestName || state.userName || 'Вы' },
  actions: {
    async restore() {
      if (this.restored) return !!this.userId
      try {
        const user = await api<User>('/auth/me')
        this.userId = user.id; this.userName = user.name; this.profileEmail = user.email
      } catch { this.userId = ''; this.userName = ''; this.profileEmail = '' }
      this.restored = true
      return !!this.userId
    },
    async signIn(email: string, password: string) {
      const result = await api<AuthResult>('/auth/login', { method: 'POST', body: json({ email, password }) }, false)
      setAccessToken(result.accessToken)
      this.userId = result.user.id; this.userName = result.user.name; this.profileEmail = result.user.email
      this.guestName = ''; sessionStorage.removeItem('pulse-guest'); this.restored = true
      await this.loadConferences()
    },
    async signOut() {
      if (this.activeRoomId && this.participantId) {
        try { await api(`/conferences/${this.activeRoomId}/leave`, { method: 'POST' }) } catch { /* Continue clearing this session. */ }
      }
      try { await api('/auth/logout', { method: 'POST' }, false) } catch { /* Local session is still cleared. */ }
      setAccessToken(null)
      this.userId = ''; this.userName = ''; this.profileEmail = ''; this.guestName = ''
      this.conferences = []; this.polls = []; this.responses = {}; this.leaveRoom()
      sessionStorage.removeItem('pulse-guest'); this.restored = true
    },
    async updateProfile(name: string) {
      const user = await api<User>('/auth/me', { method: 'PATCH', body: json({ name }) })
      this.userName = user.name; this.profileEmail = user.email
      return user
    },
    setGuestName(name: string) { this.guestName = name.trim(); sessionStorage.setItem('pulse-guest', this.guestName) },
    openRoom(id: string, role?: ParticipantRole) {
      const nextRole = role || this.roomRole
      this.activeRoomId = id; this.roomMinimized = false; this.roomRole = nextRole
      sessionStorage.setItem('pulse-active-room', id); sessionStorage.setItem('pulse-room-role', nextRole); sessionStorage.setItem('pulse-room-minimized', 'false')
    },
    minimizeRoom() { this.roomMinimized = true; sessionStorage.setItem('pulse-room-minimized', 'true') },
    leaveRoom() {
      this.activeRoomId = ''; this.roomMinimized = false; this.participantId = ''; this.roomParticipants = []
      sessionStorage.removeItem('pulse-active-room'); sessionStorage.removeItem('pulse-room-minimized'); sessionStorage.removeItem('pulse-participant-id')
    },
    async loadConferences() { this.conferences = await api<Conference[]>('/conferences'); return this.conferences },
    async loadConference(id: string) {
      const conference = await api<Conference>(`/conferences/${id}`)
      this.upsertConference(conference)
      return conference
    },
    upsertConference(conference: Conference) {
      const index = this.conferences.findIndex((item) => item.id === conference.id)
      if (index < 0) this.conferences.unshift(conference)
      else this.conferences[index] = conference
    },
    async createConference(data: Pick<Conference, 'title' | 'description' | 'startsAt' | 'allowGuests'>) {
      const conference = await api<Conference>('/conferences', { method: 'POST', body: json(data) })
      this.upsertConference(conference)
      return conference.id
    },
    async updateConference(id: string, data: Pick<Conference, 'title' | 'description' | 'startsAt' | 'allowGuests'>) {
      this.upsertConference(await api<Conference>(`/conferences/${id}`, { method: 'PATCH', body: json(data) }))
    },
    async changeConference(id: string, action: 'start' | 'end' | 'cancel') {
      const result = await api<{ conference?: Conference; participantId?: string }>(`/conferences/${id}/${action}`, { method: 'POST' })
      if (result.conference) this.upsertConference(result.conference)
      else await this.loadConferences()
      if (result.participantId) { this.participantId = result.participantId; sessionStorage.setItem('pulse-participant-id', result.participantId) }
      return result
    },
    async invitation(slug: string) { return api<Conference>(`/join/${encodeURIComponent(slug)}`, {}, false) },
    async join(slug: string, displayName: string) {
      const result = await api<JoinResult>(`/join/${encodeURIComponent(slug)}`, { method: 'POST', body: json({ displayName }) })
      this.participantId = result.participantId; sessionStorage.setItem('pulse-participant-id', result.participantId)
      sessionStorage.setItem('pulse-room-slug', slug)
      if (result.role === 'GUEST' && !this.userId) this.setGuestName(displayName)
      this.openRoom(result.conferenceId, result.role)
      return result
    },
    async loadState(id: string) {
      const state = await api<Snapshot>(`/conferences/${id}/state`)
      this.roomParticipants = state.participants; this.roomVersion = state.version
      this.participantId = state.me.id; this.roomRole = state.me.role
      this.canEndRoom = state.me.canEnd
      sessionStorage.setItem('pulse-participant-id', state.me.id); sessionStorage.setItem('pulse-room-role', state.me.role)
      const existing = this.conferences.find((item) => item.id === id)
      this.upsertConference({ id, title: state.conference.title, status: state.conference.status, slug: existing?.slug || sessionStorage.getItem('pulse-room-slug') || '', description: existing?.description || '', startsAt: existing?.startsAt || new Date().toISOString(), allowGuests: existing?.allowGuests ?? true })
      return state
    },
    async leaveConference(id: string) { await api(`/conferences/${id}/leave`, { method: 'POST' }); this.leaveRoom() },
    async mediaToken(id: string) { return api<{ url: string; token: string }>(`/conferences/${id}/media-token`, { method: 'POST' }) },
    async kick(id: string, participantId: string) { await api(`/conferences/${id}/participants/${participantId}`, { method: 'DELETE' }); await this.loadState(id) },
    async mute(id: string, participantId: string) { await api(`/conferences/${id}/participants/${participantId}/mute`, { method: 'POST' }) },
    async loadInteractions(id: string) {
      const result = await api<Interactions>(`/conferences/${id}/interactions`)
      this.polls = [...this.polls.filter((poll) => poll.conferenceId !== id), ...mapInteractions(result)]
      for (const poll of result.polls) {
        if (poll.selected?.length) this.responses[poll.id] = poll.selected
        else delete this.responses[poll.id]
      }
      return result
    },
    async loadAllInteractions() {
      await this.loadConferences()
      this.polls = []
      await Promise.all(this.conferences.filter((item) => item.status !== 'CANCELLED').map((item) => this.loadInteractions(item.id).catch(() => null)))
    },
    async createPoll(data: Pick<Poll, 'conferenceId' | 'question' | 'kind' | 'multiple' | 'options'>) {
      const path = data.kind === 'vote' ? 'votes' : 'polls'
      const created = await api<{ id: string }>(`/conferences/${data.conferenceId}/${path}`, { method: 'POST', body: json({ question: data.question, options: data.options, multiple: data.multiple }) })
      await this.loadInteractions(data.conferenceId)
      return created.id
    },
    async publishPoll(id: string) {
      const poll = this.polls.find((item) => item.id === id)
      if (!poll) throw new Error('Опрос не найден')
      await api(`/${poll.kind === 'vote' ? 'votes' : 'polls'}/${id}/${poll.kind === 'vote' ? 'open' : 'publish'}`, { method: 'POST' })
      await this.loadInteractions(poll.conferenceId)
    },
    async closePoll(id: string) {
      const poll = this.polls.find((item) => item.id === id)
      if (!poll) throw new Error('Опрос не найден')
      await api(`/${poll.kind === 'vote' ? 'votes' : 'polls'}/${id}/close`, { method: 'POST' })
      await this.loadInteractions(poll.conferenceId)
    },
    async answer(id: string, selected: number[]) {
      const poll = this.polls.find((item) => item.id === id)
      if (!poll) throw new Error('Опрос не найден')
      await api(`/${poll.kind === 'vote' ? 'votes' : 'polls'}/${id}/${poll.kind === 'vote' ? 'ballots' : 'responses'}`, { method: 'POST', body: json(poll.kind === 'vote' ? { selected: selected[0] } : { selected }) })
      if (poll.kind === 'poll') this.responses[id] = [...selected]
      await this.loadInteractions(poll.conferenceId)
    },
  },
})
