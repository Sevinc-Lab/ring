'use client'

import { useRef, useState } from 'react'
import DetectionOverlay from '../../live/DetectionOverlay'

/**
 * Recorded-clip player with an optional YOLO object overlay (same in-browser
 * detector as the live view). The boxes are drawn on the frame currently shown,
 * so it works both while playing and when paused on a frame.
 */
export default function ClipPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [detect, setDetect] = useState(false)

  return (
    <>
      <div className="player">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls preload="metadata" poster={poster} src={src} />
        <DetectionOverlay videoRef={videoRef} enabled={detect} />
      </div>
      <div className="talkRow">
        <button
          type="button"
          className={`talkBtn${detect ? ' on' : ''}`}
          onClick={() => setDetect((d) => !d)}
        >
          {detect ? '🔲 Objekt-Erkennung AUS' : '🔲 Objekte erkennen (KI)'}
        </button>
      </div>
    </>
  )
}
