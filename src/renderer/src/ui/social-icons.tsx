import {
  siBehance,
  siBluesky,
  siDiscord,
  siDribbble,
  siFacebook,
  siGithub,
  siInstagram,
  siMedium,
  siPinterest,
  siTelegram,
  siThreads,
  siTiktok,
  siTwitch,
  siWhatsapp,
  siX,
  siYoutube,
} from 'simple-icons'
import type { SocialNetwork } from '@shared/profile'

/** Logos de las redes (Simple Icons, CC0). LinkedIn no está en Simple Icons: se dibuja «in». */
const PATHS: Partial<Record<SocialNetwork, string>> = {
  instagram: siInstagram.path,
  tiktok: siTiktok.path,
  x: siX.path,
  facebook: siFacebook.path,
  youtube: siYoutube.path,
  threads: siThreads.path,
  bluesky: siBluesky.path,
  github: siGithub.path,
  behance: siBehance.path,
  dribbble: siDribbble.path,
  pinterest: siPinterest.path,
  twitch: siTwitch.path,
  medium: siMedium.path,
  telegram: siTelegram.path,
  whatsapp: siWhatsapp.path,
  discord: siDiscord.path,
}

export function SocialIcon({ id, size = 18 }: { id: SocialNetwork; size?: number }) {
  const path = PATHS[id]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {path ? (
        <path d={path} />
      ) : (
        <>
          <rect
            x="1"
            y="1"
            width="22"
            height="22"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <text
            x="12"
            y="17"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fontFamily="Arial, sans-serif"
          >
            in
          </text>
        </>
      )}
    </svg>
  )
}
