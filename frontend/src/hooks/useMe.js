import { useEffect, useState } from 'react'
import { api } from '../api.js'

// GET /me를 불러온다. 401은 api.js가 처리하므로 그 외 오류만 error로 돌려준다.
export function useMe() {
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((e) => {
        if (e.status !== 401) setError(e.message)
      })
  }, [])
  return { me, setMe, error }
}
