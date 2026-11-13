'use client'

import { PushSubscribeControl } from '@/components/push/push-subscribe-control'

/**
 * Web Push subscribe for technicians when VAPID public key is configured.
 */
export function TechPushSubscribe() {
  return <PushSubscribeControl variant="tech" className="mb-3" />
}
