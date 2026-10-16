import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireCan } from './components/Guards';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/login/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Route-level code splitting for named exports. */
function page<K extends string>(
  loader: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./pages/dashboard/DashboardPage'), 'DashboardPage');
const BatchesPage = page(() => import('./pages/batches/BatchesPage'), 'BatchesPage');
const BatchDetailPage = page(() => import('./pages/batches/BatchDetailPage'), 'BatchDetailPage');
const NewBatchPage = page(() => import('./pages/batches/NewBatchPage'), 'NewBatchPage');
const StockPage = page(() => import('./pages/stock/StockPage'), 'StockPage');
const SalesPage = page(() => import('./pages/sales/SalesPage'), 'SalesPage');
const NewSalePage = page(() => import('./pages/sales/NewSalePage'), 'NewSalePage');
const SaleDetailPage = page(() => import('./pages/sales/SaleDetailPage'), 'SaleDetailPage');
const ProductsPage = page(() => import('./pages/products/ProductsPage'), 'ProductsPage');
const TariffsPage = page(() => import('./pages/tariffs/TariffsPage'), 'TariffsPage');
const ChannelsPage = page(() => import('./pages/channels/ChannelsPage'), 'ChannelsPage');
const CustomersPage = page(() => import('./pages/customers/CustomersPage'), 'CustomersPage');
const CustomerDetailPage = page(() => import('./pages/customers/CustomerDetailPage'), 'CustomerDetailPage');
const ReportsPage = page(() => import('./pages/reports/ReportsPage'), 'ReportsPage');
const ImportPage = page(() => import('./pages/import/ImportPage'), 'ImportPage');
const BotUsersPage = page(() => import('./pages/botUsers/BotUsersPage'), 'BotUsersPage');
const UsersPage = page(() => import('./pages/users/UsersPage'), 'UsersPage');
const MorePage = page(() => import('./pages/more/MorePage'), 'MorePage');

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="batches" element={<BatchesPage />} />
          <Route
            path="batches/new"
            element={
              <RequireCan action="batches.write">
                <NewBatchPage />
              </RequireCan>
            }
          />
          <Route path="batches/:batchId" element={<BatchDetailPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route
            path="sales/new"
            element={
              <RequireCan action="sales.write">
                <NewSalePage />
              </RequireCan>
            }
          />
          <Route path="sales/:saleId" element={<SaleDetailPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="tariffs" element={<TariffsPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:customerId" element={<CustomerDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route
            path="import"
            element={
              <RequireCan action="imports.run">
                <ImportPage />
              </RequireCan>
            }
          />
          <Route
            path="bot-users"
            element={
              <RequireCan action="botUsers.manage">
                <BotUsersPage />
              </RequireCan>
            }
          />
          <Route
            path="users"
            element={
              <RequireCan action="users.manage">
                <UsersPage />
              </RequireCan>
            }
          />
          <Route path="more" element={<MorePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
