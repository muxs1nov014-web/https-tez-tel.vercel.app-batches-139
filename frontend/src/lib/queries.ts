import { useQuery, type QueryClient } from '@tanstack/react-query';
import { channelKeys, listChannels } from '../api/channels';
import {
  customerAccountKeys,
  getCustomerOverview,
  getCustomerStock,
  listCustomerBalances,
} from '../api/customerAccounts';
import { customerKeys, listCustomers, type CustomerFilter } from '../api/customers';
import { listCategories, metaKeys } from '../api/meta';
import { listProducts, productKeys } from '../api/products';
import { getSettings, settingsKeys } from '../api/settings';

const REFERENCE_STALE = 5 * 60_000;

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.all, queryFn: getSettings, staleTime: REFERENCE_STALE });
}

export function useChannels() {
  return useQuery({ queryKey: channelKeys.all, queryFn: listChannels, staleTime: REFERENCE_STALE });
}

export function useCategories() {
  return useQuery({ queryKey: metaKeys.categories, queryFn: listCategories, staleTime: Infinity });
}

export function useActiveProducts() {
  const filter = { active: true };
  return useQuery({
    queryKey: productKeys.list(filter),
    queryFn: () => listProducts(filter),
    staleTime: 60_000,
  });
}

export function useCustomerList(filter: CustomerFilter = {}) {
  return useQuery({
    queryKey: customerKeys.list(filter),
    queryFn: () => listCustomers(filter),
    staleTime: 60_000,
  });
}

export function useCustomerBalances() {
  return useQuery({ queryKey: customerAccountKeys.summary, queryFn: listCustomerBalances });
}

export function useCustomerOverview(customerId: number, enabled = true) {
  return useQuery({
    queryKey: customerAccountKeys.overview(customerId),
    queryFn: () => getCustomerOverview(customerId),
    enabled,
  });
}

/** What the customer holds (shared by the Qoldiq tab and the return / sold forms). */
export function useCustomerStock(customerId: number) {
  return useQuery({
    queryKey: customerAccountKeys.stock(customerId),
    queryFn: () => getCustomerStock(customerId),
  });
}

/**
 * Customer debt and consigned-stock value depend on sales, client-service
 * charges (purchase lines with a client) and unit costs.
 */
export function invalidateCustomerBalances(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: customerAccountKeys.summary }),
    queryClient.invalidateQueries({ queryKey: customerAccountKeys.all }),
  ]).then(() => undefined);
}

/**
 * Batches, stock, sales and reports all depend on unit costs, so any change to
 * purchases, expenses or sales invalidates the whole ledger. Customer balances
 * (debt, consigned stock) depend on sales and stock moves, so they go too.
 */
export function invalidateLedger(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['batches'] }),
    queryClient.invalidateQueries({ queryKey: ['stock'] }),
    queryClient.invalidateQueries({ queryKey: ['sales'] }),
    queryClient.invalidateQueries({ queryKey: ['reports'] }),
    invalidateCustomerBalances(queryClient),
  ]).then(() => undefined);
}
