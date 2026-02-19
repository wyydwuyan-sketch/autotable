import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'

const AppShell = lazy(() => import('./app/AppShell').then(m => ({ default: m.AppShell })))
const GridView = lazy(() => import('./features/grid/gridView/GridView').then(m => ({ default: m.GridView })))
const FormView = lazy(() => import('./features/grid/formView/FormView').then(m => ({ default: m.FormView })))
const FormViewSetup = lazy(() => import('./features/grid/formView/FormViewSetup').then(m => ({ default: m.FormViewSetup })))
const ViewManagement = lazy(() => import('./features/grid/config/ViewManagement').then(m => ({ default: m.ViewManagement })))
const TableComponents = lazy(() => import('./features/grid/config/TableComponents').then(m => ({ default: m.TableComponents })))
const DashboardConfig = lazy(() => import('./features/grid/config/DashboardConfig').then(m => ({ default: m.DashboardConfig })))
const AiModelsConfig = lazy(() => import('./features/grid/config/AiModelsConfig').then(m => ({ default: m.AiModelsConfig })))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const LoginPage = lazy(() => import('./features/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const ProtectedRoute = lazy(() => import('./features/auth/ProtectedRoute').then(m => ({ default: m.ProtectedRoute })))
const MemberManagement = lazy(() => import('./features/auth/MemberManagement').then(m => ({ default: m.MemberManagement })))

const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
)

function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/b/base_1/t/tbl_1/v/viw_1" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/b/:baseId/t/:tableId/v/:viewId" element={<AppShell />}>
            <Route index element={<GridView />} />
            <Route path="form" element={<FormView />} />
            <Route path="form-setup" element={<FormViewSetup />} />
            <Route path="config/views" element={<ViewManagement />} />
            <Route path="config/components" element={<TableComponents />} />
            <Route path="config/dashboard" element={<DashboardConfig />} />
            <Route path="config/ai-models" element={<AiModelsConfig />} />
            <Route path="config/members" element={<MemberManagement />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
