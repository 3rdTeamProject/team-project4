import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { createDiagnosisQuota, watchDiagnosisQuota } from './diagnosisQuota.js'

export default function useDiagnosisQuota() {
  const [state, setState] = useState({ quota: null, loading: true, error: '' })
  const controller = useRef(null)
  useEffect(() => {
    const current = createDiagnosisQuota({ fetchQuota: () => api.diagnosisQuota(), publish: setState })
    controller.current = current
    const stop = watchDiagnosisQuota(current, { window, document })
    current.refresh()
    return () => {
      stop()
      current.dispose()
      if (controller.current === current) controller.current = null
    }
  }, [])
  const refreshQuota = useCallback(options => controller.current?.refresh(options) ?? Promise.resolve(null), [])
  return { quota: state.quota, quotaLoading: state.loading, quotaError: state.error, refreshQuota }
}
