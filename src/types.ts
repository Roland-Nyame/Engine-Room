export type Role = 'admin' | 'member'
export type TransactionType = 'contribution' | 'expense' | 'adjustment'

export interface Profile {
  id: string
  full_name: string
  role: Role
  is_approved: boolean
  created_at: string
}

export interface FundTransaction {
  id: string
  type: TransactionType
  amount_pesewas: number
  description: string
  transaction_date: string
  contributor_id: string | null
  category: string
  reference: string | null
  created_by: string
  created_at: string
  contributor?: { full_name: string } | null
}
