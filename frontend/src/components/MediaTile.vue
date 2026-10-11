<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Track, type Room, type VideoTrack } from 'livekit-client'

const props = defineProps<{ room: Room | null; participantId: string; name: string; self: boolean; revision: number; screen?: boolean }>()
const video = ref<HTMLVideoElement | null>(null)
const attached = ref<VideoTrack | null>(null)
const source = () => props.screen ? Track.Source.ScreenShare : Track.Source.Camera

function sync() {
  if (attached.value && video.value) attached.value.detach(video.value)
  attached.value = null
  const participant = props.self ? props.room?.localParticipant : props.room?.remoteParticipants.get(props.participantId)
  const track = participant?.getTrackPublication(source())?.videoTrack
  if (track && video.value && !track.isMuted) { track.attach(video.value); attached.value = track }
}

watch(() => [props.room, props.participantId, props.revision, props.screen, video.value], sync, { immediate: true })
onBeforeUnmount(() => { if (attached.value && video.value) attached.value.detach(video.value) })
function initials(name: string) { return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase() }
</script>

<template>
  <div class="video-tile" :class="{ 'is-self': self }">
    <video v-show="attached" ref="video" autoplay playsinline :muted="self" style="width:100%;height:100%;object-fit:cover" />
    <span v-if="!attached" class="video-initials">{{ initials(name) }}</span>
    <span class="video-label">{{ name }}{{ self ? ' (Вы)' : '' }}</span>
  </div>
</template>
