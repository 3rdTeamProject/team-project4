import { Link, Navigate } from 'react-router-dom'
import { storage } from '../api.js'
import './screens.css'
export default function GardenPending({ title, description }) {
  if (!storage.token) return <Navigate to="/" replace />
  return <div className="screen"><header className="screen-header"><h1 className="screen-title">{title}</h1><Link to="/menu" className="icon-btn" aria-label="메뉴로 돌아가기">✕</Link></header><p className="muted">{description}</p></div>
}
