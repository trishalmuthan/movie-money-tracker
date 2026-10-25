import type { RouteObject } from 'react-router'
import { CreditFormPage } from '../pages/CreditFormPage'
import { GiftCardFormPage } from '../pages/GiftCardFormPage'
import { ActivityPage, NotFoundPage } from '../pages/placeholders'
import { SettingsPage } from '../pages/SettingsPage'
import { VisitFormPage } from '../pages/VisitFormPage'
import { Layout } from './Layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <ActivityPage /> }, // home until the M6 dashboard
      { path: 'visits/new', element: <VisitFormPage mode="new" /> },
      { path: 'visits/:id/edit', element: <VisitFormPage mode="edit" /> },
      { path: 'gift-cards/new', element: <GiftCardFormPage mode="new" /> },
      { path: 'gift-cards/:id/edit', element: <GiftCardFormPage mode="edit" /> },
      { path: 'credits/new', element: <CreditFormPage mode="new" /> },
      { path: 'credits/:id/edit', element: <CreditFormPage mode="edit" /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
