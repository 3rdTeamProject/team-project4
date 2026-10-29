import { useEffect, useState } from 'react'
import { api } from '../api.js'

// 도감 화면 사이를 오갈 때 목록이 비어 보이지 않게, 마지막으로 받은 작물을 보여 주면서 새로 받아 온다.
let lastCrops = null

// GET /garden/dex를 불러온다. 401은 api.js가 처리하므로 그 외 오류만 error로 돌려준다.
export function useDex() {
  const [crops, setCrops] = useState(lastCrops)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api
      .gardenDex()
      .then((data) => {
        lastCrops = data.crops
        if (alive) setCrops(data.crops)
      })
      .catch((e) => {
        if (alive && e.status !== 401) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [])
  return { crops, error }
}
