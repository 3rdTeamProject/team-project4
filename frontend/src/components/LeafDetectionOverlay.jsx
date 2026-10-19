function isValidDetection(detection) {
  const { x, y, width, height } = detection ?? {}
  return [x, y, width, height].every(Number.isFinite)
    && x >= 0 && y >= 0
    && width > 0 && height > 0
    && x + width <= 1 && y + height <= 1
}

export default function LeafDetectionOverlay({ detections = [] }) {
  const validDetections = detections.filter(isValidDetection)

  if (validDetections.length === 0) return null

  return (
    <div className="diagnosis-detection-layer" aria-label="탐지된 의심 부위">
      {validDetections.map((detection, index) => (
        <div
          key={`${detection.x}-${detection.y}-${index}`}
          className="diagnosis-detection-box"
          style={{
            left: `${detection.x * 100}%`,
            top: `${detection.y * 100}%`,
            width: `${detection.width * 100}%`,
            height: `${detection.height * 100}%`,
          }}
        >
          {detection.label && <span>{detection.label}</span>}
        </div>
      ))}
    </div>
  )
}
