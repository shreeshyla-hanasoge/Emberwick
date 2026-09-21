import React from 'react'
import { BRAND_PATHS } from '../brand.js'

export default function BrandLogo({ className = '', title = 'Emberwick' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 2418 289"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {BRAND_PATHS.map((d) => <path d={d} key={d} />)}
    </svg>
  )
}
