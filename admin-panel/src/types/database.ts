export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          details: Json
          id: string
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      affiliate_commissions: {
        Row: {
          accrued_minor: number
          base_minor: number
          binding_id: string
          buffer_days: number
          currency: string
          dispute_reviewed_at: string | null
          dispute_seen: boolean
          eligible_at: string | null
          hold_days: number
          id: string
          is_refundable: boolean
          line_item_id: string
          livemode: boolean
          member_id: string
          observed_refunded_gross: number
          observed_status: string
          paid_at: string
          payment_id: string
          refund_period_days: number | null
          rule_id: string
          self_referral: boolean
          session_created_at: string
          version: number
        }
        Insert: {
          accrued_minor: number
          base_minor: number
          binding_id: string
          buffer_days: number
          currency: string
          dispute_reviewed_at?: string | null
          dispute_seen?: boolean
          eligible_at?: string | null
          hold_days: number
          id?: string
          is_refundable: boolean
          line_item_id: string
          livemode: boolean
          member_id: string
          observed_refunded_gross: number
          observed_status: string
          paid_at: string
          payment_id: string
          refund_period_days?: number | null
          rule_id: string
          self_referral: boolean
          session_created_at: string
          version?: number
        }
        Update: {
          accrued_minor?: number
          base_minor?: number
          binding_id?: string
          buffer_days?: number
          currency?: string
          dispute_reviewed_at?: string | null
          dispute_seen?: boolean
          eligible_at?: string | null
          hold_days?: number
          id?: string
          is_refundable?: boolean
          line_item_id?: string
          livemode?: boolean
          member_id?: string
          observed_refunded_gross?: number
          observed_status?: string
          paid_at?: string
          payment_id?: string
          refund_period_days?: number | null
          rule_id?: string
          self_referral?: boolean
          session_created_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "affiliate_coupon_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "payment_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "affiliate_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_coupon_bindings: {
        Row: {
          coupon_id: string
          created_at: string
          id: string
          member_id: string
          retired_at: string | null
          version: number
        }
        Insert: {
          coupon_id: string
          created_at?: string
          id?: string
          member_id: string
          retired_at?: string | null
          version: number
        }
        Update: {
          coupon_id?: string
          created_at?: string
          id?: string
          member_id?: string
          retired_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_coupon_bindings_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_coupon_bindings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_ledger: {
        Row: {
          amount_minor: number
          commission_id: string | null
          created_at: string
          currency: string
          economic_key: string
          evidence_reference: string | null
          id: string
          kind: string
          member_id: string
          payout_id: string | null
          reason: string | null
        }
        Insert: {
          amount_minor: number
          commission_id?: string | null
          created_at?: string
          currency: string
          economic_key: string
          evidence_reference?: string | null
          id?: string
          kind: string
          member_id: string
          payout_id?: string | null
          reason?: string | null
        }
        Update: {
          amount_minor?: number
          commission_id?: string | null
          created_at?: string
          currency?: string
          economic_key?: string
          evidence_reference?: string | null
          id?: string
          kind?: string
          member_id?: string
          payout_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_ledger_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "affiliate_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_ledger_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: true
            referencedRelation: "affiliate_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_membership_events: {
        Row: {
          created_at: string
          member_id: string
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          member_id: string
          status: string
          version: number
        }
        Update: {
          created_at?: string
          member_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_membership_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_memberships: {
        Row: {
          accepted_at: string
          accepted_terms_version: string
          channel: string | null
          code: string
          created_at: string
          display_name: string
          id: string
          status: string
          user_id: string | null
          version: number
        }
        Insert: {
          accepted_at: string
          accepted_terms_version: string
          channel?: string | null
          code: string
          created_at?: string
          display_name: string
          id?: string
          status?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          accepted_at?: string
          accepted_terms_version?: string
          channel?: string | null
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          status?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "affiliate_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      affiliate_payout_allocations: {
        Row: {
          entry_id: string
          payout_id: string
          released_at: string | null
        }
        Insert: {
          entry_id: string
          payout_id: string
          released_at?: string | null
        }
        Update: {
          entry_id?: string
          payout_id?: string
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payout_allocations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "affiliate_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_payout_allocations_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "affiliate_payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          bank_amount_minor: number | null
          bank_reference: string | null
          created_at: string
          currency: string
          cutoff: string
          earnings_minor: number
          id: string
          invoice_reference: string | null
          livemode: boolean
          member_id: string
          needs_review: boolean
          paid_at: string | null
          payee_reference: string
          status: string
          version: number
        }
        Insert: {
          bank_amount_minor?: number | null
          bank_reference?: string | null
          created_at?: string
          currency: string
          cutoff: string
          earnings_minor: number
          id?: string
          invoice_reference?: string | null
          livemode?: boolean
          member_id: string
          needs_review?: boolean
          paid_at?: string | null
          payee_reference: string
          status: string
          version?: number
        }
        Update: {
          bank_amount_minor?: number | null
          bank_reference?: string | null
          created_at?: string
          currency?: string
          cutoff?: string
          earnings_minor?: number
          id?: string
          invoice_reference?: string | null
          livemode?: boolean
          member_id?: string
          needs_review?: boolean
          paid_at?: string | null
          payee_reference?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_program_versions: {
        Row: {
          buffer_days: number
          created_at: string
          enabled: boolean
          hold_days: number
          program_id: string
          terms: Json
          terms_version: string
          thresholds: Json
          version: number
        }
        Insert: {
          buffer_days: number
          created_at?: string
          enabled: boolean
          hold_days: number
          program_id: string
          terms: Json
          terms_version: string
          thresholds: Json
          version: number
        }
        Update: {
          buffer_days?: number
          created_at?: string
          enabled?: boolean
          hold_days?: number
          program_id?: string
          terms?: Json
          terms_version?: string
          thresholds?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_program_versions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "affiliate_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_programs: {
        Row: {
          buffer_days: number
          enabled: boolean
          hold_days: number
          id: string
          singleton: boolean
          terms: Json
          terms_version: string
          thresholds: Json
          version: number
        }
        Insert: {
          buffer_days?: number
          enabled?: boolean
          hold_days?: number
          id?: string
          singleton?: boolean
          terms: Json
          terms_version: string
          thresholds?: Json
          version?: number
        }
        Update: {
          buffer_days?: number
          enabled?: boolean
          hold_days?: number
          id?: string
          singleton?: boolean
          terms?: Json
          terms_version?: string
          thresholds?: Json
          version?: number
        }
        Relationships: []
      }
      affiliate_rules: {
        Row: {
          created_at: string
          currency: string | null
          enabled: boolean
          fixed_minor: number | null
          id: string
          percentage_bps: number | null
          product_id: string
          revision: number
        }
        Insert: {
          created_at?: string
          currency?: string | null
          enabled: boolean
          fixed_minor?: number | null
          id?: string
          percentage_bps?: number | null
          product_id: string
          revision: number
        }
        Update: {
          created_at?: string
          currency?: string | null
          enabled?: boolean
          fixed_minor?: number | null
          id?: string
          percentage_bps?: number | null
          product_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_work: {
        Row: {
          attempts: number
          dispute_seen: boolean
          kind: string
          last_error_code: string | null
          lease_token: string | null
          leased_until: string | null
          next_attempt_at: string
          payment_id: string
          processed_generation: number
          requested_generation: number
          status: string
        }
        Insert: {
          attempts?: number
          dispute_seen?: boolean
          kind?: string
          last_error_code?: string | null
          lease_token?: string | null
          leased_until?: string | null
          next_attempt_at?: string
          payment_id: string
          processed_generation?: number
          requested_generation?: number
          status: string
        }
        Update: {
          attempts?: number
          dispute_seen?: boolean
          kind?: string
          last_error_code?: string | null
          lease_token?: string | null
          leased_until?: string | null
          next_attempt_at?: string
          payment_id?: string
          processed_generation?: number
          requested_generation?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_work_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_audit_log: {
        Row: {
          api_key_id: string | null
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          ip_address: unknown
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "api_key_audit_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          admin_user_id: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          last_used_ip: unknown
          name: string
          rate_limit_per_minute: number | null
          revoked_at: string | null
          revoked_reason: string | null
          rotated_from_id: string | null
          rotation_grace_until: string | null
          scopes: Json
          usage_count: number
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name: string
          rate_limit_per_minute?: number | null
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from_id?: string | null
          rotation_grace_until?: string | null
          scopes?: Json
          usage_count?: number
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          last_used_ip?: unknown
          name?: string
          rate_limit_per_minute?: number | null
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from_id?: string | null
          rotation_grace_until?: string | null
          scopes?: Json
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_rotated_from_id_fkey"
            columns: ["rotated_from_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      application_rate_limits: {
        Row: {
          action_type: string
          call_count: number
          created_at: string
          id: string
          identifier: string
          updated_at: string
          window_start: string
        }
        Insert: {
          action_type: string
          call_count?: number
          created_at?: string
          id?: string
          identifier: string
          updated_at?: string
          window_start: string
        }
        Update: {
          action_type?: string
          call_count?: number
          created_at?: string
          id?: string
          identifier?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      attribution_channel_rules: {
        Row: {
          channel: string
          created_at: string
          field: string
          id: string
          is_active: boolean
          is_default: boolean
          operator: string
          priority: number
          value: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          field: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          operator: string
          priority: number
          value?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          field?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          operator?: string
          priority?: number
          value?: string | null
        }
        Relationships: []
      }
      attribution_settings: {
        Row: {
          click_id_retention_days: number
          id: number
          updated_at: string
        }
        Insert: {
          click_id_retention_days?: number
          id?: number
          updated_at?: string
        }
        Update: {
          click_id_retention_days?: number
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          operation: string
          performed_at: string
          performed_by: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          operation: string
          performed_at?: string
          performed_by?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          operation?: string
          performed_at?: string
          performed_by?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bank_transfer_config: {
        Row: {
          bank_account_holder: string
          bank_account_number: string
          bank_name: string
          bank_transfer_due_days: number
          bank_transfer_enabled: boolean
          bank_transfer_grant_access_on_placement: boolean
          bank_transfer_max_unpaid_per_email: number
          bank_transfer_title_template: string
          declared_hold_hours: number
          id: boolean
          reservation_enabled: boolean
          reservation_release_hours: number
          reservation_reminder_hours: number
        }
        Insert: {
          bank_account_holder?: string
          bank_account_number?: string
          bank_name?: string
          bank_transfer_due_days?: number
          bank_transfer_enabled?: boolean
          bank_transfer_grant_access_on_placement?: boolean
          bank_transfer_max_unpaid_per_email?: number
          bank_transfer_title_template?: string
          declared_hold_hours?: number
          id?: boolean
          reservation_enabled?: boolean
          reservation_release_hours?: number
          reservation_reminder_hours?: number
        }
        Update: {
          bank_account_holder?: string
          bank_account_number?: string
          bank_name?: string
          bank_transfer_due_days?: number
          bank_transfer_enabled?: boolean
          bank_transfer_grant_access_on_placement?: boolean
          bank_transfer_max_unpaid_per_email?: number
          bank_transfer_title_template?: string
          declared_hold_hours?: number
          id?: boolean
          reservation_enabled?: boolean
          reservation_release_hours?: number
          reservation_reminder_hours?: number
        }
        Relationships: []
      }
      bundle_items: {
        Row: {
          bundle_product_id: string
          component_product_id: string
          created_at: string
          display_order: number
          id: string
        }
        Insert: {
          bundle_product_id: string
          component_product_id: string
          created_at?: string
          display_order?: number
          id?: string
        }
        Update: {
          bundle_product_id?: string
          component_product_id?: string
          created_at?: string
          display_order?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_product_id_fkey"
            columns: ["bundle_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      business_events: {
        Row: {
          created_at: string
          deduplication_key: string | null
          dispatched_at: string | null
          event_type: string
          id: string
          leased_until: string | null
          payload: Json
          product_id: string
        }
        Insert: {
          created_at?: string
          deduplication_key?: string | null
          dispatched_at?: string | null
          event_type: string
          id?: string
          leased_until?: string | null
          payload: Json
          product_id: string
        }
        Update: {
          created_at?: string
          deduplication_key?: string | null
          dispatched_at?: string | null
          event_type?: string
          id?: string
          leased_until?: string | null
          payload?: Json
          product_id?: string
        }
        Relationships: []
      }
      captcha_nonces: {
        Row: {
          created_at: string
          expires_at: string
          nonce_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          nonce_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          nonce_hash?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          parent_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_attribution: {
        Row: {
          created_at: string
          payload: Json
          ref: string
        }
        Insert: {
          created_at?: string
          payload: Json
          ref: string
        }
        Update: {
          created_at?: string
          payload?: Json
          ref?: string
        }
        Relationships: []
      }
      consent_logs: {
        Row: {
          anonymous_id: string | null
          consent_version: string | null
          consents: Json | null
          created_at: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          consent_version?: string | null
          consents?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          consent_version?: string | null
          consents?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          customer_email: string
          discount_amount: number
          id: string
          redeemed_at: string
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          coupon_id: string
          customer_email: string
          discount_amount: number
          id?: string
          redeemed_at?: string
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          coupon_id?: string
          customer_email?: string
          discount_amount?: number
          id?: string
          redeemed_at?: string
          transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      coupon_reservations: {
        Row: {
          coupon_id: string
          customer_email: string
          expires_at: string
          id: string
          reserved_at: string
          session_id: string | null
        }
        Insert: {
          coupon_id: string
          customer_email: string
          expires_at: string
          id?: string
          reserved_at?: string
          session_id?: string | null
        }
        Update: {
          coupon_id?: string
          customer_email?: string
          expires_at?: string
          id?: string
          reserved_at?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_reservations_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          allowed_emails: Json
          allowed_product_ids: Json
          code: string
          coupon_role: string | null
          created_at: string
          currency: string | null
          current_usage_count: number
          discount_type: string
          discount_value: number
          duration: string
          duration_in_months: number | null
          exclude_order_bumps: boolean
          expires_at: string | null
          id: string
          is_active: boolean
          is_oto_coupon: boolean
          is_public: boolean
          name: string | null
          oto_offer_id: string | null
          source_transaction_id: string | null
          starts_at: string
          updated_at: string
          usage_limit_global: number | null
          usage_limit_per_user: number | null
        }
        Insert: {
          allowed_emails?: Json
          allowed_product_ids?: Json
          code: string
          coupon_role?: string | null
          created_at?: string
          currency?: string | null
          current_usage_count?: number
          discount_type: string
          discount_value: number
          duration?: string
          duration_in_months?: number | null
          exclude_order_bumps?: boolean
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_oto_coupon?: boolean
          is_public?: boolean
          name?: string | null
          oto_offer_id?: string | null
          source_transaction_id?: string | null
          starts_at?: string
          updated_at?: string
          usage_limit_global?: number | null
          usage_limit_per_user?: number | null
        }
        Update: {
          allowed_emails?: Json
          allowed_product_ids?: Json
          code?: string
          coupon_role?: string | null
          created_at?: string
          currency?: string | null
          current_usage_count?: number
          discount_type?: string
          discount_value?: number
          duration?: string
          duration_in_months?: number | null
          exclude_order_bumps?: boolean
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_oto_coupon?: boolean
          is_public?: boolean
          name?: string | null
          oto_offer_id?: string | null
          source_transaction_id?: string | null
          starts_at?: string
          updated_at?: string
          usage_limit_global?: number | null
          usage_limit_per_user?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_oto_offer_id_fkey"
            columns: ["oto_offer_id"]
            isOneToOne: false
            referencedRelation: "oto_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_scripts: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          script_content: string
          script_location: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          script_content: string
          script_location: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          script_content?: string
          script_location?: string
          updated_at?: string
        }
        Relationships: []
      }
      embed_checkout_log: {
        Row: {
          action: string
          created_at: string
          email: string | null
          embed_session_id: string | null
          id: string
          origin: string | null
          product_id: string | null
          product_slug: string
          status: string
          stripe_session_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          email?: string | null
          embed_session_id?: string | null
          id?: string
          origin?: string | null
          product_id?: string | null
          product_slug: string
          status: string
          stripe_session_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          email?: string | null
          embed_session_id?: string | null
          id?: string
          origin?: string | null
          product_id?: string | null
          product_slug?: string
          status?: string
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embed_checkout_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      free_grant_contexts: {
        Row: {
          claimed_at: string | null
          created_at: string
          custom_field_values: Json
          email: string
          expires_at: string
          id: string
          product_id: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          custom_field_values: Json
          email: string
          expires_at?: string
          id?: string
          product_id: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          custom_field_values?: Json
          email?: string
          expires_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_grant_contexts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_purchases: {
        Row: {
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          customer_email: string
          id: string
          metadata: Json
          product_id: string
          session_id: string | null
          transaction_amount: number
          transaction_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          customer_email: string
          id?: string
          metadata?: Json
          product_id: string
          session_id?: string | null
          transaction_amount: number
          transaction_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          customer_email?: string
          id?: string
          metadata?: Json
          product_id?: string
          session_id?: string | null
          transaction_amount?: number
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_purchases_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "guest_purchases_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "guest_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_purchases_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations_config: {
        Row: {
          consent_logging_enabled: boolean | null
          conversion_tracking_mode: string
          cookie_consent_enabled: boolean | null
          created_at: string
          currency_api_enabled: boolean
          currency_api_key_encrypted: string | null
          currency_api_key_iv: string | null
          currency_api_key_tag: string | null
          currency_api_provider: string | null
          facebook_capi_token: string | null
          facebook_capi_token_encrypted: string | null
          facebook_capi_token_iv: string | null
          facebook_capi_token_tag: string | null
          facebook_pixel_id: string | null
          facebook_test_event_code: string | null
          fb_capi_enabled: boolean | null
          google_ads_conversion_id: string | null
          google_ads_conversion_label: string | null
          gtm_container_id: string | null
          gtm_server_container_url: string | null
          gtm_ss_enabled: boolean | null
          gus_api_enabled: boolean
          gus_api_key_encrypted: string | null
          gus_api_key_iv: string | null
          gus_api_key_tag: string | null
          id: number
          sellf_license: string | null
          umami_script_url: string | null
          umami_website_id: string | null
          updated_at: string
        }
        Insert: {
          consent_logging_enabled?: boolean | null
          conversion_tracking_mode?: string
          cookie_consent_enabled?: boolean | null
          created_at?: string
          currency_api_enabled?: boolean
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
          facebook_capi_token_encrypted?: string | null
          facebook_capi_token_iv?: string | null
          facebook_capi_token_tag?: string | null
          facebook_pixel_id?: string | null
          facebook_test_event_code?: string | null
          fb_capi_enabled?: boolean | null
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          gtm_container_id?: string | null
          gtm_server_container_url?: string | null
          gtm_ss_enabled?: boolean | null
          gus_api_enabled?: boolean
          gus_api_key_encrypted?: string | null
          gus_api_key_iv?: string | null
          gus_api_key_tag?: string | null
          id?: number
          sellf_license?: string | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string
        }
        Update: {
          consent_logging_enabled?: boolean | null
          conversion_tracking_mode?: string
          cookie_consent_enabled?: boolean | null
          created_at?: string
          currency_api_enabled?: boolean
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
          facebook_capi_token_encrypted?: string | null
          facebook_capi_token_iv?: string | null
          facebook_capi_token_tag?: string | null
          facebook_pixel_id?: string | null
          facebook_test_event_code?: string | null
          fb_capi_enabled?: boolean | null
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          gtm_container_id?: string | null
          gtm_server_container_url?: string | null
          gtm_ss_enabled?: boolean | null
          gus_api_enabled?: boolean
          gus_api_key_encrypted?: string | null
          gus_api_key_iv?: string | null
          gus_api_key_tag?: string | null
          id?: number
          sellf_license?: string | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          external_key: string
          id: string
          number: string | null
          payment_synced: boolean
          provider: string
          provider_domain: string
          provider_invoice_id: string | null
          status: string
          transaction_id: string
          updated_at: string
          view_url: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          external_key: string
          id?: string
          number?: string | null
          payment_synced?: boolean
          provider: string
          provider_domain: string
          provider_invoice_id?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
          view_url?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          external_key?: string
          id?: string
          number?: string | null
          payment_synced?: boolean
          provider?: string
          provider_domain?: string
          provider_invoice_id?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
          view_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoicing_config: {
        Row: {
          auto_since: string | null
          domain: string
          exemption: string
          id: boolean
          instance_id: string
          mode: string
          provider: string
          template: string
          token: Json | null
        }
        Insert: {
          auto_since?: string | null
          domain?: string
          exemption?: string
          id?: boolean
          instance_id?: string
          mode?: string
          provider?: string
          template?: string
          token?: Json | null
        }
        Update: {
          auto_since?: string | null
          domain?: string
          exemption?: string
          id?: boolean
          instance_id?: string
          mode?: string
          provider?: string
          template?: string
          token?: Json | null
        }
        Relationships: []
      }
      issued_licenses: {
        Row: {
          email: string | null
          expires_at: string | null
          id: string
          issuance_source: string
          issued_at: string
          kid: string
          license_domain: string | null
          license_key: string
          order_id: string
          original_seller_id: string
          product_id: string
          revoked_at: string | null
          revoked_by_dispute_id: string | null
          seller_id: string | null
          user_id: string | null
        }
        Insert: {
          email?: string | null
          expires_at?: string | null
          id?: string
          issuance_source?: string
          issued_at?: string
          kid: string
          license_domain?: string | null
          license_key: string
          order_id: string
          original_seller_id: string
          product_id: string
          revoked_at?: string | null
          revoked_by_dispute_id?: string | null
          seller_id?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string | null
          expires_at?: string | null
          id?: string
          issuance_source?: string
          issued_at?: string
          kid?: string
          license_domain?: string | null
          license_key?: string
          order_id?: string
          original_seller_id?: string
          product_id?: string
          revoked_at?: string | null
          revoked_by_dispute_id?: string | null
          seller_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issued_licenses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_licenses_revoked_by_dispute_id_fkey"
            columns: ["revoked_by_dispute_id"]
            isOneToOne: false
            referencedRelation: "payment_disputes"
            referencedColumns: ["stripe_dispute_id"]
          },
          {
            foreignKeyName: "issued_licenses_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "issued_licenses_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "issued_licenses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "issued_licenses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      lead_nonces: {
        Row: {
          expires_at: string
          nonce_hash: string
          origin: string
          product_id: string | null
          signature: string
        }
        Insert: {
          expires_at?: string
          nonce_hash: string
          origin: string
          product_id?: string | null
          signature: string
        }
        Update: {
          expires_at?: string
          nonce_hash?: string
          origin?: string
          product_id?: string | null
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_nonces_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_submissions: {
        Row: {
          client_consent_text: string | null
          confirmed_at: string | null
          consent_text: string | null
          consent_version: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          marketing_consent: boolean
          product_id: string | null
          product_slug: string | null
          source: string
          token_hash: string
        }
        Insert: {
          client_consent_text?: string | null
          confirmed_at?: string | null
          consent_text?: string | null
          consent_version?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          marketing_consent?: boolean
          product_id?: string | null
          product_slug?: string | null
          source: string
          token_hash: string
        }
        Update: {
          client_consent_text?: string | null
          confirmed_at?: string | null
          consent_text?: string | null
          consent_version?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          marketing_consent?: boolean
          product_id?: string | null
          product_slug?: string | null
          source?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_submissions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_bumps: {
        Row: {
          access_duration_days: number | null
          bump_description: string | null
          bump_price: number | null
          bump_product_id: string
          bump_title: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          main_product_id: string
          updated_at: string
          urgency_duration_minutes: number | null
        }
        Insert: {
          access_duration_days?: number | null
          bump_description?: string | null
          bump_price?: number | null
          bump_product_id: string
          bump_title: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          main_product_id: string
          updated_at?: string
          urgency_duration_minutes?: number | null
        }
        Update: {
          access_duration_days?: number | null
          bump_description?: string | null
          bump_price?: number | null
          bump_product_id?: string
          bump_title?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          main_product_id?: string
          updated_at?: string
          urgency_duration_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_bumps_bump_product_id_fkey"
            columns: ["bump_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_bumps_main_product_id_fkey"
            columns: ["main_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payment_attempts: {
        Row: {
          amount: number
          checkout_url: string | null
          completed_at: string | null
          created_at: string
          currency: string
          expires_at: string
          id: string
          kind: string
          refund_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          transaction_id: string
        }
        Insert: {
          amount: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          currency: string
          expires_at: string
          id?: string
          kind: string
          refund_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          transaction_id: string
        }
        Update: {
          amount?: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          kind?: string
          refund_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payment_attempts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      oto_offers: {
        Row: {
          created_at: string
          discount_type: string
          discount_value: number
          display_order: number
          downsell_discount_type: string | null
          downsell_discount_value: number | null
          downsell_duration_minutes: number | null
          downsell_product_id: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          oto_product_id: string
          source_product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_type: string
          discount_value: number
          display_order?: number
          downsell_discount_type?: string | null
          downsell_discount_value?: number | null
          downsell_duration_minutes?: number | null
          downsell_product_id?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          oto_product_id: string
          source_product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_type?: string
          discount_value?: number
          display_order?: number
          downsell_discount_type?: string | null
          downsell_discount_value?: number | null
          downsell_duration_minutes?: number | null
          downsell_product_id?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          oto_product_id?: string
          source_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oto_offers_downsell_product_id_fkey"
            columns: ["downsell_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oto_offers_oto_product_id_fkey"
            columns: ["oto_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oto_offers_source_product_id_fkey"
            columns: ["source_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_disputes: {
        Row: {
          account_access: Json
          closed: boolean
          guest_access: Json
          payload: Json
          previous_payment_status: string
          revoked_license_ids: string[]
          status: string
          stripe_dispute_id: string
          suspended_at: string
          transaction_id: string
        }
        Insert: {
          account_access?: Json
          closed?: boolean
          guest_access?: Json
          payload?: Json
          previous_payment_status: string
          revoked_license_ids?: string[]
          status: string
          stripe_dispute_id: string
          suspended_at: string
          transaction_id: string
        }
        Update: {
          account_access?: Json
          closed?: boolean
          guest_access?: Json
          payload?: Json
          previous_payment_status?: string
          revoked_license_ids?: string[]
          status?: string
          stripe_dispute_id?: string
          suspended_at?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_line_items: {
        Row: {
          access_duration_override: number | null
          created_at: string
          currency: string
          discounted_total: number | null
          id: string
          item_type: Database["public"]["Enums"]["line_item_type"]
          metadata: Json
          net_amount: number | null
          order_bump_id: string | null
          product_id: string
          product_name: string | null
          quantity: number
          session_id: string | null
          session_label: string | null
          session_starts_at: string | null
          tax_amount: number | null
          tax_behavior: string | null
          tax_breakdown: Json
          taxability_reason: string | null
          tier_id: string | null
          tier_label: string | null
          total_price: number
          transaction_id: string
          unit_price: number
          vat_exempt: boolean
          vat_rate: number | null
        }
        Insert: {
          access_duration_override?: number | null
          created_at?: string
          currency: string
          discounted_total?: number | null
          id?: string
          item_type: Database["public"]["Enums"]["line_item_type"]
          metadata?: Json
          net_amount?: number | null
          order_bump_id?: string | null
          product_id: string
          product_name?: string | null
          quantity?: number
          session_id?: string | null
          session_label?: string | null
          session_starts_at?: string | null
          tax_amount?: number | null
          tax_behavior?: string | null
          tax_breakdown?: Json
          taxability_reason?: string | null
          tier_id?: string | null
          tier_label?: string | null
          total_price: number
          transaction_id: string
          unit_price: number
          vat_exempt?: boolean
          vat_rate?: number | null
        }
        Update: {
          access_duration_override?: number | null
          created_at?: string
          currency?: string
          discounted_total?: number | null
          id?: string
          item_type?: Database["public"]["Enums"]["line_item_type"]
          metadata?: Json
          net_amount?: number | null
          order_bump_id?: string | null
          product_id?: string
          product_name?: string | null
          quantity?: number
          session_id?: string | null
          session_label?: string | null
          session_starts_at?: string | null
          tax_amount?: number | null
          tax_behavior?: string | null
          tax_breakdown?: Json
          taxability_reason?: string | null
          tier_id?: string | null
          tier_label?: string | null
          total_price?: number
          transaction_id?: string
          unit_price?: number
          vat_exempt?: boolean
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_line_items_order_bump_id_fkey"
            columns: ["order_bump_id"]
            isOneToOne: false
            referencedRelation: "order_bumps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_line_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_config: {
        Row: {
          available_payment_methods: Json | null
          config_mode: string
          created_at: string
          currency_overrides: Json | null
          custom_payment_methods: Json | null
          enable_apple_pay: boolean
          enable_express_checkout: boolean
          enable_google_pay: boolean
          enable_link: boolean
          id: number
          last_modified_by: string | null
          payment_method_order: Json | null
          stripe_pmc_id: string | null
          stripe_pmc_last_synced: string | null
          stripe_pmc_name: string | null
          updated_at: string
        }
        Insert: {
          available_payment_methods?: Json | null
          config_mode?: string
          created_at?: string
          currency_overrides?: Json | null
          custom_payment_methods?: Json | null
          enable_apple_pay?: boolean
          enable_express_checkout?: boolean
          enable_google_pay?: boolean
          enable_link?: boolean
          id?: number
          last_modified_by?: string | null
          payment_method_order?: Json | null
          stripe_pmc_id?: string | null
          stripe_pmc_last_synced?: string | null
          stripe_pmc_name?: string | null
          updated_at?: string
        }
        Update: {
          available_payment_methods?: Json | null
          config_mode?: string
          created_at?: string
          currency_overrides?: Json | null
          custom_payment_methods?: Json | null
          enable_apple_pay?: boolean
          enable_express_checkout?: boolean
          enable_google_pay?: boolean
          enable_link?: boolean
          id?: number
          last_modified_by?: string | null
          payment_method_order?: Json | null
          stripe_pmc_id?: string | null
          stripe_pmc_last_synced?: string | null
          stripe_pmc_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_config_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_method_config_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_refund_events: {
        Row: {
          created_at: string
          notified: boolean
          previous_status: string | null
          status: string | null
          stripe_refund_id: string
          version: number
        }
        Insert: {
          created_at?: string
          notified?: boolean
          previous_status?: string | null
          status?: string | null
          stripe_refund_id: string
          version: number
        }
        Update: {
          created_at?: string
          notified?: boolean
          previous_status?: string | null
          status?: string | null
          stripe_refund_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_refund_events_stripe_refund_id_fkey"
            columns: ["stripe_refund_id"]
            isOneToOne: false
            referencedRelation: "payment_refunds"
            referencedColumns: ["stripe_refund_id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount: number
          created_at: string
          currency: string
          notified_version: number
          previous_status: string | null
          status: string | null
          stripe_refund_id: string
          transaction_id: string
          updated_at: string
          version: number
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          notified_version?: number
          previous_status?: string | null
          status?: string | null
          stripe_refund_id: string
          transaction_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          notified_version?: number
          previous_status?: string | null
          status?: string | null
          stripe_refund_id?: string
          transaction_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          abandoned_at: string | null
          amount: number
          cancel_reason: string | null
          cancelled_mail_sent_at: string | null
          coupon_id: string | null
          created_at: string
          currency: string
          custom_field_values: Json
          customer_email: string
          expires_at: string | null
          fulfillment_pending: boolean
          id: string
          invoice_hold_at: string | null
          livemode: boolean
          metadata: Json
          net_total: number | null
          order_cancelled_notified_at: string | null
          order_details: Json | null
          order_invoice_issued_notified_at: string | null
          order_number: number
          order_overdue_notified_at: string | null
          order_placed_notified_at: string | null
          order_reminder_notified_at: string | null
          order_reopened_notified_at: string | null
          order_transfer_declared_notified_at: string | null
          paid_at: string | null
          payment_due_at: string | null
          payment_provider: string
          pricing_snapshot_version: number | null
          product_id: string
          refund_id: string | null
          refund_reason: string | null
          refund_status: string | null
          refunded_amount: number | null
          refunded_at: string | null
          refunded_by: string | null
          release_at: string | null
          reminder_at: string | null
          reminder_mail_sent_at: string | null
          reopened_at: string | null
          session_id: string | null
          settled_via: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          subscription_id: string | null
          tax_snapshot_status: string
          tax_total: number | null
          transfer_declared_at: string | null
          transfer_declared_note: string | null
          transfer_details: Json | null
          transfer_mail_sent_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          abandoned_at?: string | null
          amount: number
          cancel_reason?: string | null
          cancelled_mail_sent_at?: string | null
          coupon_id?: string | null
          created_at?: string
          currency: string
          custom_field_values?: Json
          customer_email: string
          expires_at?: string | null
          fulfillment_pending?: boolean
          id?: string
          invoice_hold_at?: string | null
          livemode?: boolean
          metadata?: Json
          net_total?: number | null
          order_cancelled_notified_at?: string | null
          order_details?: Json | null
          order_invoice_issued_notified_at?: string | null
          order_number?: number
          order_overdue_notified_at?: string | null
          order_placed_notified_at?: string | null
          order_reminder_notified_at?: string | null
          order_reopened_notified_at?: string | null
          order_transfer_declared_notified_at?: string | null
          paid_at?: string | null
          payment_due_at?: string | null
          payment_provider?: string
          pricing_snapshot_version?: number | null
          product_id: string
          refund_id?: string | null
          refund_reason?: string | null
          refund_status?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          release_at?: string | null
          reminder_at?: string | null
          reminder_mail_sent_at?: string | null
          reopened_at?: string | null
          session_id?: string | null
          settled_via?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          tax_snapshot_status?: string
          tax_total?: number | null
          transfer_declared_at?: string | null
          transfer_declared_note?: string | null
          transfer_details?: Json | null
          transfer_mail_sent_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          abandoned_at?: string | null
          amount?: number
          cancel_reason?: string | null
          cancelled_mail_sent_at?: string | null
          coupon_id?: string | null
          created_at?: string
          currency?: string
          custom_field_values?: Json
          customer_email?: string
          expires_at?: string | null
          fulfillment_pending?: boolean
          id?: string
          invoice_hold_at?: string | null
          livemode?: boolean
          metadata?: Json
          net_total?: number | null
          order_cancelled_notified_at?: string | null
          order_details?: Json | null
          order_invoice_issued_notified_at?: string | null
          order_number?: number
          order_overdue_notified_at?: string | null
          order_placed_notified_at?: string | null
          order_reminder_notified_at?: string | null
          order_reopened_notified_at?: string | null
          order_transfer_declared_notified_at?: string | null
          paid_at?: string | null
          payment_due_at?: string | null
          payment_provider?: string
          pricing_snapshot_version?: number | null
          product_id?: string
          refund_id?: string | null
          refund_reason?: string | null
          refund_status?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          release_at?: string | null
          reminder_at?: string | null
          reminder_mail_sent_at?: string | null
          reopened_at?: string | null
          session_id?: string | null
          settled_via?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          tax_snapshot_status?: string
          tax_total?: number | null
          transfer_declared_at?: string | null
          transfer_declared_note?: string | null
          transfer_details?: Json | null
          transfer_mail_sent_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_transactions_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_offer_config: {
        Row: {
          draft: Json | null
          product_id: string
          published: Json | null
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          draft?: Json | null
          product_id: string
          published?: Json | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          draft?: Json | null
          product_id?: string
          published?: Json | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_offer_config_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_offer_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_offer_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_offer_history: {
        Row: {
          actor_id: string | null
          created_at: string
          draft: Json | null
          operation: string
          product_id: string
          published: Json | null
          restored_from: number | null
          revision: number
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          draft?: Json | null
          operation: string
          product_id: string
          published?: Json | null
          restored_from?: number | null
          revision: number
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          draft?: Json | null
          operation?: string
          product_id?: string
          published?: Json | null
          restored_from?: number | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_offer_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_offer_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_offer_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_offer_history_product_id_restored_from_fkey"
            columns: ["product_id", "restored_from"]
            isOneToOne: false
            referencedRelation: "product_offer_history"
            referencedColumns: ["product_id", "revision"]
          },
        ]
      }
      product_price_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          currency: string
          effective_from: string
          effective_until: string | null
          id: string
          price: number
          price_includes_vat: boolean | null
          product_id: string
          sale_price: number | null
          vat_rate: number | null
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          currency: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          price: number
          price_includes_vat?: boolean | null
          product_id: string
          sale_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          price?: number
          price_includes_vat?: boolean | null
          product_id?: string
          sale_price?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_tiers: {
        Row: {
          id: string
          label: string | null
          price: number
          sale_ends_at: string | null
          seats: number | null
          session_id: string
          sort: number
        }
        Insert: {
          id?: string
          label?: string | null
          price: number
          sale_ends_at?: string | null
          seats?: number | null
          session_id: string
          sort: number
        }
        Update: {
          id?: string
          label?: string | null
          price?: number
          sale_ends_at?: string | null
          seats?: number | null
          session_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_price_tiers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "product_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sessions: {
        Row: {
          capacity: number | null
          created_at: string
          ends_at: string | null
          extra_days: string | null
          id: string
          online_url: string | null
          product_id: string
          sales_open: boolean
          sort: number
          starts_at: string
          timezone: string
          title: string | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          ends_at?: string | null
          extra_days?: string | null
          id?: string
          online_url?: string | null
          product_id: string
          sales_open?: boolean
          sort?: number
          starts_at: string
          timezone?: string
          title?: string | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string
          ends_at?: string | null
          extra_days?: string | null
          id?: string
          online_url?: string | null
          product_id?: string
          sales_open?: boolean
          sort?: number
          starts_at?: string
          timezone?: string
          title?: string | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tags: {
        Row: {
          created_at: string
          product_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variant_groups: {
        Row: {
          created_at: string
          display_order: number
          group_id: string
          id: string
          is_featured: boolean
          product_id: string
          variant_name: string | null
        }
        Insert: {
          created_at?: string
          display_order?: number
          group_id: string
          id?: string
          is_featured?: boolean
          product_id: string
          variant_name?: string | null
        }
        Update: {
          created_at?: string
          display_order?: number
          group_id?: string
          id?: string
          is_featured?: boolean
          product_id?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variant_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "variant_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allow_custom_price: boolean
          allow_repeat_purchase: boolean
          auto_grant_duration_days: number | null
          available_from: string | null
          available_until: string | null
          billing_interval: string | null
          billing_interval_count: number | null
          checkout_profile: Json | null
          checkout_template: string
          content_config: Json
          content_delivery_type: string
          created_at: string
          currency: string
          custom_checkout_fields: Json
          custom_price_min: number | null
          custom_price_presets: Json | null
          description: string | null
          embed_enabled: boolean
          enable_waitlist: boolean
          event_mode: boolean
          features: Json | null
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_bundle: boolean
          is_featured: boolean
          is_listed: boolean
          is_refundable: boolean
          issue_license_on_purchase: boolean
          layout_template: string
          lead_consent_required: boolean
          lead_consent_text_en: string
          lead_consent_text_pl: string
          lead_consent_version: string
          license_duration_days: number | null
          license_tier: string | null
          long_description: string | null
          marketing_fields: Json
          name: string
          omnibus_exempt: boolean
          pass_params_to_redirect: boolean
          preview_video_config: Json
          preview_video_url: string | null
          price: number
          price_includes_vat: boolean
          product_type: string
          recurring_price: number | null
          refund_period_days: number | null
          sale_price: number | null
          sale_price_until: string | null
          sale_quantity_limit: number | null
          sale_quantity_sold: number
          seller_id: string | null
          show_price_presets: boolean
          slug: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          success_redirect_url: string | null
          thumbnail_url: string | null
          trial_days: number | null
          updated_at: string
          vat_exempt: boolean
          vat_exempt_note: string | null
          vat_rate: number | null
        }
        Insert: {
          allow_custom_price?: boolean
          allow_repeat_purchase?: boolean
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          billing_interval?: string | null
          billing_interval_count?: number | null
          checkout_profile?: Json | null
          checkout_template?: string
          content_config?: Json
          content_delivery_type?: string
          created_at?: string
          currency?: string
          custom_checkout_fields?: Json
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          embed_enabled?: boolean
          enable_waitlist?: boolean
          event_mode?: boolean
          features?: Json | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bundle?: boolean
          is_featured?: boolean
          is_listed?: boolean
          is_refundable?: boolean
          issue_license_on_purchase?: boolean
          layout_template?: string
          lead_consent_required?: boolean
          lead_consent_text_en?: string
          lead_consent_text_pl?: string
          lead_consent_version?: string
          license_duration_days?: number | null
          license_tier?: string | null
          long_description?: string | null
          marketing_fields?: Json
          name: string
          omnibus_exempt?: boolean
          pass_params_to_redirect?: boolean
          preview_video_config?: Json
          preview_video_url?: string | null
          price?: number
          price_includes_vat?: boolean
          product_type?: string
          recurring_price?: number | null
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number
          seller_id?: string | null
          show_price_presets?: boolean
          slug: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          trial_days?: number | null
          updated_at?: string
          vat_exempt?: boolean
          vat_exempt_note?: string | null
          vat_rate?: number | null
        }
        Update: {
          allow_custom_price?: boolean
          allow_repeat_purchase?: boolean
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          billing_interval?: string | null
          billing_interval_count?: number | null
          checkout_profile?: Json | null
          checkout_template?: string
          content_config?: Json
          content_delivery_type?: string
          created_at?: string
          currency?: string
          custom_checkout_fields?: Json
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          embed_enabled?: boolean
          enable_waitlist?: boolean
          event_mode?: boolean
          features?: Json | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bundle?: boolean
          is_featured?: boolean
          is_listed?: boolean
          is_refundable?: boolean
          issue_license_on_purchase?: boolean
          layout_template?: string
          lead_consent_required?: boolean
          lead_consent_text_en?: string
          lead_consent_text_pl?: string
          lead_consent_version?: string
          license_duration_days?: number | null
          license_tier?: string | null
          long_description?: string | null
          marketing_fields?: Json
          name?: string
          omnibus_exempt?: boolean
          pass_params_to_redirect?: boolean
          preview_video_config?: Json
          preview_video_url?: string | null
          price?: number
          price_includes_vat?: boolean
          product_type?: string
          recurring_price?: number | null
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number
          seller_id?: string | null
          show_price_presets?: boolean
          slug?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          trial_days?: number | null
          updated_at?: string
          vat_exempt?: boolean
          vat_exempt_note?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          display_name: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          preferred_language: string | null
          state: string | null
          tax_id: string | null
          timezone: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          preferred_language?: string | null
          state?: string | null
          tax_id?: string | null
          timezone?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          preferred_language?: string | null
          state?: string | null
          tax_id?: string | null
          timezone?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      purchase_attribution: {
        Row: {
          affiliate_member_id: string | null
          channel: string
          click_id: string | null
          click_id_expires_at: string | null
          click_id_type: string | null
          consent: string
          country: string | null
          created_at: string
          device_class: string
          first_at: string | null
          first_campaign: string | null
          first_channel: string | null
          first_content: string | null
          first_landing_path: string | null
          first_medium: string | null
          first_referrer_host: string | null
          first_seen_at: string | null
          first_source: string | null
          first_term: string | null
          first_utm_id: string | null
          id: string
          kind: string
          last_at: string | null
          last_campaign: string | null
          last_content: string | null
          last_landing_path: string | null
          last_medium: string | null
          last_referrer_host: string | null
          last_source: string | null
          last_term: string | null
          last_utm_id: string | null
          mode: string
          product_id: string | null
          sessions_count: number | null
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          affiliate_member_id?: string | null
          channel: string
          click_id?: string | null
          click_id_expires_at?: string | null
          click_id_type?: string | null
          consent: string
          country?: string | null
          created_at?: string
          device_class?: string
          first_at?: string | null
          first_campaign?: string | null
          first_channel?: string | null
          first_content?: string | null
          first_landing_path?: string | null
          first_medium?: string | null
          first_referrer_host?: string | null
          first_seen_at?: string | null
          first_source?: string | null
          first_term?: string | null
          first_utm_id?: string | null
          id?: string
          kind: string
          last_at?: string | null
          last_campaign?: string | null
          last_content?: string | null
          last_landing_path?: string | null
          last_medium?: string | null
          last_referrer_host?: string | null
          last_source?: string | null
          last_term?: string | null
          last_utm_id?: string | null
          mode: string
          product_id?: string | null
          sessions_count?: number | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          affiliate_member_id?: string | null
          channel?: string
          click_id?: string | null
          click_id_expires_at?: string | null
          click_id_type?: string | null
          consent?: string
          country?: string | null
          created_at?: string
          device_class?: string
          first_at?: string | null
          first_campaign?: string | null
          first_channel?: string | null
          first_content?: string | null
          first_landing_path?: string | null
          first_medium?: string | null
          first_referrer_host?: string | null
          first_seen_at?: string | null
          first_source?: string | null
          first_term?: string | null
          first_utm_id?: string | null
          id?: string
          kind?: string
          last_at?: string | null
          last_campaign?: string | null
          last_content?: string | null
          last_landing_path?: string | null
          last_medium?: string | null
          last_referrer_host?: string | null
          last_source?: string | null
          last_term?: string | null
          last_utm_id?: string | null
          mode?: string
          product_id?: string | null
          sessions_count?: number | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_attribution_affiliate_member_id_fkey"
            columns: ["affiliate_member_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_attribution_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_attribution_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_attribution_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "purchase_attribution_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          call_count: number
          created_at: string
          function_name: string
          updated_at: string
          user_id: string
          window_start: string
        }
        Insert: {
          call_count?: number
          created_at?: string
          function_name: string
          updated_at?: string
          user_id: string
          window_start: string
        }
        Update: {
          call_count?: number
          created_at?: string
          function_name?: string
          updated_at?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          admin_id: string | null
          admin_response: string | null
          created_at: string
          currency: string
          customer_email: string
          id: string
          processed_at: string | null
          product_id: string
          reason: string | null
          requested_amount: number
          status: string
          transaction_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_id?: string | null
          admin_response?: string | null
          created_at?: string
          currency: string
          customer_email: string
          id?: string
          processed_at?: string | null
          product_id: string
          reason?: string | null
          requested_amount: number
          status?: string
          transaction_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_id?: string | null
          admin_response?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          id?: string
          processed_at?: string | null
          product_id?: string
          reason?: string | null
          requested_amount?: number
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refund_requests_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refund_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      revenue_goals: {
        Row: {
          created_at: string
          goal_amount: number
          id: string
          product_id: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          goal_amount: number
          id?: string
          product_id?: string | null
          start_date?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          goal_amount?: number
          id?: string
          product_id?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_goals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_reservations: {
        Row: {
          confirmed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          quantity: number
          released_at: string | null
          session_id: string
          status: string
          tier_id: string
          transaction_id: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          quantity: number
          released_at?: string | null
          session_id: string
          status: string
          tier_id: string
          transaction_id: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          quantity?: number
          released_at?: string | null
          session_id?: string
          status?: string
          tier_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_reservations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "product_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_reservations_tier_id_session_id_fkey"
            columns: ["tier_id", "session_id"]
            isOneToOne: false
            referencedRelation: "product_price_tiers"
            referencedColumns: ["id", "session_id"]
          },
          {
            foreignKeyName: "seat_reservations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_embed_settings: {
        Row: {
          allowed_embed_origins: string[]
          created_at: string
          seller_id: string
          updated_at: string
        }
        Insert: {
          allowed_embed_origins?: string[]
          created_at?: string
          seller_id: string
          updated_at?: string
        }
        Update: {
          allowed_embed_origins?: string[]
          created_at?: string
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_embed_settings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: true
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "seller_embed_settings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      seller_license_keys: {
        Row: {
          alg: string
          created_at: string
          custody: string
          encrypted_key: string
          encryption_iv: string
          encryption_tag: string
          id: string
          is_active: boolean
          kid: string
          original_seller_id: string
          public_key: string
          seller_id: string | null
        }
        Insert: {
          alg?: string
          created_at?: string
          custody: string
          encrypted_key: string
          encryption_iv: string
          encryption_tag: string
          id?: string
          is_active?: boolean
          kid: string
          original_seller_id: string
          public_key: string
          seller_id?: string | null
        }
        Update: {
          alg?: string
          created_at?: string
          custody?: string
          encrypted_key?: string
          encryption_iv?: string
          encryption_tag?: string
          id?: string
          is_active?: boolean
          kid?: string
          original_seller_id?: string
          public_key?: string
          seller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_license_keys_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "seller_license_keys_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      shop_config: {
        Row: {
          automatic_tax_enabled: boolean | null
          checkout_billing_address: string | null
          checkout_collect_terms: boolean | null
          checkout_expires_hours: number | null
          checkout_theme: string | null
          company_building_no: string | null
          company_city: string | null
          company_flat_no: string | null
          company_legal_name: string | null
          company_phone: string | null
          company_postal: string | null
          company_street: string | null
          complaints_email: string | null
          contact_email: string | null
          country: string | null
          created_at: string
          custom_settings: Json | null
          default_currency: string
          dpo_contact: string | null
          font_family: string | null
          has_dpo: boolean
          id: string
          is_micro_enterprise: boolean
          is_vat_exempt: boolean
          krs: string | null
          legal_form: string | null
          logo_url: string | null
          nip: string | null
          omnibus_enabled: boolean
          privacy_policy_url: string | null
          regon: string | null
          shop_name: string
          stripe_tax_rate_cache: Json | null
          tax_id_collection_enabled: boolean | null
          tax_mode: string | null
          tax_rate: number | null
          terms_of_service_url: string | null
          updated_at: string
          vat_exempt_note: string | null
        }
        Insert: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          company_building_no?: string | null
          company_city?: string | null
          company_flat_no?: string | null
          company_legal_name?: string | null
          company_phone?: string | null
          company_postal?: string | null
          company_street?: string | null
          complaints_email?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          custom_settings?: Json | null
          default_currency?: string
          dpo_contact?: string | null
          font_family?: string | null
          has_dpo?: boolean
          id?: string
          is_micro_enterprise?: boolean
          is_vat_exempt?: boolean
          krs?: string | null
          legal_form?: string | null
          logo_url?: string | null
          nip?: string | null
          omnibus_enabled?: boolean
          privacy_policy_url?: string | null
          regon?: string | null
          shop_name?: string
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string
          vat_exempt_note?: string | null
        }
        Update: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          company_building_no?: string | null
          company_city?: string | null
          company_flat_no?: string | null
          company_legal_name?: string | null
          company_phone?: string | null
          company_postal?: string | null
          company_street?: string | null
          complaints_email?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          custom_settings?: Json | null
          default_currency?: string
          dpo_contact?: string | null
          font_family?: string | null
          has_dpo?: boolean
          id?: string
          is_micro_enterprise?: boolean
          is_vat_exempt?: boolean
          krs?: string | null
          legal_form?: string | null
          logo_url?: string | null
          nip?: string | null
          omnibus_enabled?: boolean
          privacy_policy_url?: string | null
          regon?: string | null
          shop_name?: string
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string
          vat_exempt_note?: string | null
        }
        Relationships: []
      }
      storefront_config: {
        Row: {
          draft: Json | null
          id: boolean
          published: Json
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          draft?: Json | null
          id?: boolean
          published: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          draft?: Json | null
          id?: boolean
          published?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storefront_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "storefront_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      storefront_config_history: {
        Row: {
          actor_id: string | null
          created_at: string
          draft: Json | null
          operation: string
          published: Json
          restored_from: number | null
          revision: number
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          draft?: Json | null
          operation: string
          published: Json
          restored_from?: number | null
          revision: number
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          draft?: Json | null
          operation?: string
          published?: Json
          restored_from?: number | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "storefront_config_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "storefront_config_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "storefront_config_history_restored_from_fkey"
            columns: ["restored_from"]
            isOneToOne: false
            referencedRelation: "storefront_config_history"
            referencedColumns: ["revision"]
          },
        ]
      }
      stripe_configurations: {
        Row: {
          account_id: string | null
          created_at: string
          encrypted_key: string
          encryption_iv: string
          encryption_tag: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_last_4: string
          key_prefix: string
          last_validated_at: string | null
          mode: string
          permissions_verified: boolean
          rotation_reminder_sent: boolean | null
          updated_at: string
          webhook_endpoint_id: string | null
          webhook_signing_iv: string | null
          webhook_signing_secret_enc: string | null
          webhook_signing_tag: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          encrypted_key: string
          encryption_iv: string
          encryption_tag: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_last_4: string
          key_prefix: string
          last_validated_at?: string | null
          mode: string
          permissions_verified?: boolean
          rotation_reminder_sent?: boolean | null
          updated_at?: string
          webhook_endpoint_id?: string | null
          webhook_signing_iv?: string | null
          webhook_signing_secret_enc?: string | null
          webhook_signing_tag?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          encrypted_key?: string
          encryption_iv?: string
          encryption_tag?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_last_4?: string
          key_prefix?: string
          last_validated_at?: string | null
          mode?: string
          permissions_verified?: boolean
          rotation_reminder_sent?: boolean | null
          updated_at?: string
          webhook_endpoint_id?: string | null
          webhook_signing_iv?: string | null
          webhook_signing_secret_enc?: string | null
          webhook_signing_tag?: string | null
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at: string
          id: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          latest_invoice_id: string | null
          metadata: Json
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          latest_invoice_id?: string | null
          metadata?: Json
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          latest_invoice_id?: string | null
          metadata?: Json
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      telemetry_state: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          last_attempt_at: string | null
          last_sent_at: string | null
          report_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id?: string
          last_attempt_at?: string | null
          last_sent_at?: string | null
          report_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          last_attempt_at?: string | null
          last_sent_at?: string | null
          report_id?: string | null
        }
        Relationships: []
      }
      template_credentials: {
        Row: {
          encrypted_key: string | null
          encryption_iv: string | null
          encryption_tag: string | null
          state: string
          template_id: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          encrypted_key?: string | null
          encryption_iv?: string | null
          encryption_tag?: string | null
          state?: string
          template_id: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          encrypted_key?: string | null
          encryption_iv?: string | null
          encryption_tag?: string | null
          state?: string
          template_id?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      tracking_logs: {
        Row: {
          created_at: string
          currency: string | null
          customer_email: string | null
          destination: string | null
          duration_ms: number | null
          error_message: string | null
          event_id: string
          event_name: string
          event_source_url: string | null
          events_received: number | null
          http_status: number | null
          id: string
          order_id: string | null
          product_id: string | null
          skip_reason: string | null
          source: string
          status: string
          value: number | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          destination?: string | null
          duration_ms?: number | null
          error_message?: string | null
          event_id: string
          event_name: string
          event_source_url?: string | null
          events_received?: number | null
          http_status?: number | null
          id?: string
          order_id?: string | null
          product_id?: string | null
          skip_reason?: string | null
          source: string
          status: string
          value?: number | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          destination?: string | null
          duration_ms?: number | null
          error_message?: string | null
          event_id?: string
          event_name?: string
          event_source_url?: string | null
          events_received?: number | null
          http_status?: number | null
          id?: string
          order_id?: string | null
          product_id?: string | null
          skip_reason?: string | null
          source?: string
          status?: string
          value?: number | null
        }
        Relationships: []
      }
      user_product_access: {
        Row: {
          access_duration_days: number | null
          access_expires_at: string | null
          access_granted_at: string
          created_at: string
          custom_field_values: Json
          expiry_notified_at: string | null
          id: string
          product_id: string
          subscription_id: string | null
          transfer_transaction_id: string | null
          user_id: string
          version: number
        }
        Insert: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string
          created_at?: string
          custom_field_values?: Json
          expiry_notified_at?: string | null
          id?: string
          product_id: string
          subscription_id?: string | null
          transfer_transaction_id?: string | null
          user_id: string
          version?: number
        }
        Update: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string
          created_at?: string
          custom_field_values?: Json
          expiry_notified_at?: string | null
          id?: string
          product_id?: string
          subscription_id?: string | null
          transfer_transaction_id?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_product_access_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_access_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_access_transfer_transaction_id_fkey"
            columns: ["transfer_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_product_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      variant_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      video_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          position_seconds: number
          progress_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          position_seconds: number
          progress_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          position_seconds?: number
          progress_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_events_progress_id_fkey"
            columns: ["progress_id"]
            isOneToOne: false
            referencedRelation: "video_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      video_progress: {
        Row: {
          created_at: string
          id: string
          is_completed: boolean
          last_position_seconds: number
          max_position_seconds: number
          product_id: string
          updated_at: string
          user_id: string
          video_duration_seconds: number | null
          video_id: string
          view_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_completed?: boolean
          last_position_seconds?: number
          max_position_seconds?: number
          product_id: string
          updated_at?: string
          user_id: string
          video_duration_seconds?: number | null
          video_id: string
          view_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_completed?: boolean
          last_position_seconds?: number
          max_position_seconds?: number
          product_id?: string
          updated_at?: string
          user_id?: string
          video_duration_seconds?: number | null
          video_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_progress_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "video_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_endpoint_products: {
        Row: {
          created_at: string
          product_id: string
          webhook_endpoint_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          webhook_endpoint_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          webhook_endpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoint_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_endpoint_products_webhook_endpoint_id_fkey"
            columns: ["webhook_endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          custom_headers_encrypted: string | null
          custom_payload_fields: Json | null
          description: string | null
          events: string[]
          id: string
          is_active: boolean | null
          payload_field_selection: Json | null
          product_filter_mode: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          custom_headers_encrypted?: string | null
          custom_payload_fields?: Json | null
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          payload_field_selection?: Json | null
          product_filter_mode?: string
          secret?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          custom_headers_encrypted?: string | null
          custom_payload_fields?: Json | null
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          payload_field_selection?: Json | null
          product_filter_mode?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          attempt_count: number
          created_at: string
          delivery_key: string | null
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          event_type: string
          failed_permanently_at: string | null
          http_status: number | null
          id: string
          max_attempts: number
          next_retry_at: string | null
          payload: Json | null
          response_body: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivery_key?: string | null
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type: string
          failed_permanently_at?: string | null
          http_status?: number | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          response_body?: string | null
          status: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivery_key?: string | null
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type?: string
          failed_permanently_at?: string | null
          http_status?: number | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          response_body?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      omnibus_price_history: {
        Row: {
          currency: string | null
          effective_from: string | null
          price: number | null
          product_id: string | null
          sale_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_system_health: {
        Row: {
          avg_transaction_amount: number | null
          completed_transactions: number | null
          disputed_transactions: number | null
          records_last_24h: number | null
          refunded_transactions: number | null
          snapshot_time: string | null
          table_name: string | null
          total_records: number | null
        }
        Relationships: []
      }
      rate_limit_summary: {
        Row: {
          avg_calls_per_user: number | null
          function_name: string | null
          last_activity: string | null
          max_calls_per_user: number | null
          total_calls: number | null
          unique_users: number | null
        }
        Relationships: []
      }
      seller_customer_stats: {
        Row: {
          email: string | null
          email_confirmed_at: string | null
          first_access_granted_at: string | null
          last_access_granted_at: string | null
          last_sign_in_at: string | null
          raw_user_meta_data: Json | null
          total_products: number | null
          total_value: number | null
          user_created_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      user_access_stats: {
        Row: {
          email: string | null
          email_confirmed_at: string | null
          first_access_granted_at: string | null
          last_access_granted_at: string | null
          last_sign_in_at: string | null
          raw_user_meta_data: Json | null
          total_products: number | null
          total_value: number | null
          user_created_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      user_product_access_detailed: {
        Row: {
          access_created_at: string | null
          access_duration_days: number | null
          access_expires_at: string | null
          access_granted_at: string | null
          id: string | null
          product_created_at: string | null
          product_currency: string | null
          product_description: string | null
          product_icon: string | null
          product_id: string | null
          product_is_active: boolean | null
          product_name: string | null
          product_price: number | null
          product_slug: string | null
          product_updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_product_access_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_product_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "seller_customer_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_product_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
      _claim_guest_purchases_before_disputes: {
        Args: { p_user_id: string }
        Returns: Json
      }
      _order_grant_and_record: {
        Args: {
          p_coupon_id: string
          p_coupon_mode: string
          p_existing_user_id: string
          p_requested_user_id: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: Json
      }
      _place_order_without_event: {
        Args: { p_lines: Json; p_order: Json }
        Returns: Json
      }
      _process_stripe_payment_completion_with_bump_impl: {
        Args: {
          amount_subtotal_param?: number
          amount_total: number
          bump_product_ids_param?: string[]
          coupon_id_param?: string
          currency_param: string
          customer_email_param: string
          product_id_param: string
          session_id_param: string
          stripe_payment_intent_id?: string
          user_id_param?: string
        }
        Returns: Json
      }
      _redeem_coupon_for_order: {
        Args: {
          coupon_id_param: string
          current_user_id: string
          customer_email_param: string
          existing_user_id: string
          transaction_id_var: string
        }
        Returns: undefined
      }
      _reopen_cancelled_transfer: { Args: { p_id: string }; Returns: undefined }
      _reserve_coupon: {
        Args: {
          coupon_id_param: string
          currency_param: string
          customer_email_param: string
          product_id_param: string
        }
        Returns: Json
      }
      admin_bank_transfer_order: {
        Args: {
          p_accept_cancelled?: boolean
          p_action: string
          p_actor?: string
          p_amount?: number
          p_id: string
          p_paid_at?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_delete_oto_offer: {
        Args: { source_product_id_param: string }
        Returns: Json
      }
      admin_get_product_order_bumps: {
        Args: { product_id_param: string }
        Returns: {
          access_duration_days: number
          bump_description: string
          bump_id: string
          bump_price: number
          bump_product_id: string
          bump_product_name: string
          bump_title: string
          created_at: string
          display_order: number
          is_active: boolean
          updated_at: string
          urgency_duration_minutes: number
        }[]
      }
      admin_get_product_oto_offer: {
        Args: { product_id_param: string }
        Returns: Json
      }
      admin_save_oto_offer: {
        Args: {
          discount_type_param: string
          discount_value_param: number
          downsell_discount_type_param?: string
          downsell_discount_value_param?: number
          downsell_duration_minutes_param?: number
          downsell_product_id_param?: string
          duration_minutes_param?: number
          is_active_param?: boolean
          oto_product_id_param: string
          source_product_id_param: string
        }
        Returns: Json
      }
      affiliate_admin: { Args: { p_actor: string }; Returns: undefined }
      affiliate_apply: {
        Args: {
          p_channel: string
          p_code: string
          p_display_name: string
          p_terms_version: string
          p_user: string
        }
        Returns: {
          accepted_at: string
          accepted_terms_version: string
          channel: string | null
          code: string
          created_at: string
          display_name: string
          id: string
          status: string
          user_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_apply_sync: {
        Args: {
          p_generation: number
          p_livemode: boolean
          p_payment: string
          p_session_created_at: string
          p_token: string
        }
        Returns: boolean
      }
      affiliate_audit: {
        Args: { p_actor: string; p_new: Json; p_old: Json; p_table: string }
        Returns: undefined
      }
      affiliate_cancel_payout: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_no_transfer: boolean
          p_payout: string
          p_reason: string
        }
        Returns: {
          bank_amount_minor: number | null
          bank_reference: string | null
          created_at: string
          currency: string
          cutoff: string
          earnings_minor: number
          id: string
          invoice_reference: string | null
          livemode: boolean
          member_id: string
          needs_review: boolean
          paid_at: string | null
          payee_reference: string
          status: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_claim_work: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          dispute_seen: boolean
          kind: string
          last_error_code: string | null
          lease_token: string | null
          leased_until: string | null
          next_attempt_at: string
          payment_id: string
          processed_generation: number
          requested_generation: number
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "affiliate_work"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      affiliate_complete_unbound_work: {
        Args: { p_generation: number; p_payment: string; p_token: string }
        Returns: boolean
      }
      affiliate_coupon_bind: {
        Args: {
          p_actor: string
          p_coupon: string
          p_expected_version: number
          p_member: string
        }
        Returns: {
          coupon_id: string
          created_at: string
          id: string
          member_id: string
          retired_at: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_coupon_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_lock_member: {
        Args: {
          p_currency: string
          p_livemode?: boolean
          p_member: string
          p_payments?: string[]
        }
        Returns: string[]
      }
      affiliate_manual_adjustment: {
        Args: {
          p_actor: string
          p_amount_minor: number
          p_commission: string
          p_evidence_reference: string
          p_expected_version: number
          p_reason: string
          p_review_dispute: boolean
        }
        Returns: {
          amount_minor: number
          commission_id: string | null
          created_at: string
          currency: string
          economic_key: string
          evidence_reference: string | null
          id: string
          kind: string
          member_id: string
          payout_id: string | null
          reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_mark_paid: {
        Args: {
          p_actor: string
          p_bank_amount_minor: number
          p_bank_reference: string
          p_currency: string
          p_evidence_reference?: string
          p_expected_version: number
          p_full_settlement: boolean
          p_invoice_reference: string
          p_livemode?: boolean
          p_paid_at: string
          p_payout: string
          p_reason?: string
        }
        Returns: {
          bank_amount_minor: number | null
          bank_reference: string | null
          created_at: string
          currency: string
          cutoff: string
          earnings_minor: number
          id: string
          invoice_reference: string | null
          livemode: boolean
          member_id: string
          needs_review: boolean
          paid_at: string | null
          payee_reference: string
          status: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_member_update: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_member: string
          p_reason: string
          p_status: string
        }
        Returns: {
          accepted_at: string
          accepted_terms_version: string
          channel: string | null
          code: string
          created_at: string
          display_name: string
          id: string
          status: string
          user_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_portal_page: {
        Args: {
          p_as_of?: string
          p_currency?: string
          p_cursor?: string
          p_limit?: number
          p_member: string
        }
        Returns: Json
      }
      affiliate_portal_summary: {
        Args: { p_as_of: string; p_livemode?: boolean; p_member: string }
        Returns: Json
      }
      affiliate_preview: {
        Args: {
          p_currency: string
          p_cutoff: string
          p_livemode?: boolean
          p_member: string
        }
        Returns: {
          accrued: string
          available: boolean
          balance: string
          debt_offset_minor: string
          earnings_minor: string
          entry_ids: string[]
          held_minor: string
          member_version: string
          paid: string
          payable_minor: string
          program_version: string
          reserved: string
          reversed: string
          sync_required: boolean
          threshold_minor: string
        }[]
      }
      affiliate_program_update: {
        Args: {
          p_actor: string
          p_buffer_days: number
          p_enabled: boolean
          p_expected_version: number
          p_hold_days: number
          p_terms: Json
          p_terms_version: string
          p_thresholds: Json
        }
        Returns: {
          buffer_days: number
          enabled: boolean
          hold_days: number
          id: string
          singleton: boolean
          terms: Json
          terms_version: string
          thresholds: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_reserve: {
        Args: {
          p_actor: string
          p_currency: string
          p_cutoff: string
          p_livemode?: boolean
          p_member: string
          p_member_version: number
          p_payee_reference: string
          p_program_version: number
        }
        Returns: {
          bank_amount_minor: number | null
          bank_reference: string | null
          created_at: string
          currency: string
          cutoff: string
          earnings_minor: number
          id: string
          invoice_reference: string | null
          livemode: boolean
          member_id: string
          needs_review: boolean
          paid_at: string | null
          payee_reference: string
          status: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_payouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_retry_work: {
        Args: {
          p_error: string
          p_generation: number
          p_payment: string
          p_token: string
        }
        Returns: boolean
      }
      affiliate_rule_create: {
        Args: {
          p_actor: string
          p_currency: string
          p_enabled: boolean
          p_expected_revision: number
          p_fixed_minor: number
          p_percentage_bps: number
          p_product: string
        }
        Returns: {
          created_at: string
          currency: string | null
          enabled: boolean
          fixed_minor: number | null
          id: string
          percentage_bps: number | null
          product_id: string
          revision: number
        }
        SetofOptions: {
          from: "*"
          to: "affiliate_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      affiliate_valid_program: {
        Args: { p_terms: Json; p_thresholds: Json }
        Returns: boolean
      }
      affiliate_valid_reference: { Args: { p_value: string }; Returns: boolean }
      affiliate_work_retry: {
        Args: {
          p_actor: string
          p_generation: number
          p_payment: string
          p_reason: string
        }
        Returns: undefined
      }
      apply_migration: {
        Args: {
          content_checksum: string
          migration_sql: string
          migration_version: string
        }
        Returns: Json
      }
      apply_payment_dispute: {
        Args: {
          p_amount: number
          p_closed: boolean
          p_created: string
          p_currency: string
          p_dispute_id: string
          p_reason: string
          p_status: string
          p_transaction_id: string
        }
        Returns: Json
      }
      attach_order_payment_session: {
        Args: { p_attempt: string; p_session_id: string; p_url?: string }
        Returns: undefined
      }
      attribution_text: {
        Args: { k: string; max_len: number; p: Json }
        Returns: string
      }
      attribution_time: { Args: { k: string; p: Json }; Returns: string }
      bank_transfer_order: {
        Args: { p_lines: Json; p_order: Json }
        Returns: Json
      }
      batch_check_user_product_access: {
        Args: { product_slugs_param: string[] }
        Returns: Json
      }
      cancel_unpaid_order: {
        Args: { p_reason: string; p_transaction_id: string }
        Returns: Json
      }
      capture_expired_access: { Args: never; Returns: number }
      check_application_rate_limit: {
        Args: {
          action_type_param: string
          identifier_param: string
          max_requests: number
          window_minutes: number
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          function_name_param: string
          identifier_param?: string
          max_calls?: number
          time_window_seconds?: number
        }
        Returns: boolean
      }
      check_refund_eligibility: {
        Args: { transaction_id_param: string }
        Returns: Json
      }
      check_user_product_access: {
        Args: { product_slug_param: string }
        Returns: boolean
      }
      check_waitlist_config: { Args: never; Returns: Json }
      claim_business_events: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          deduplication_key: string | null
          dispatched_at: string | null
          event_type: string
          id: string
          leased_until: string | null
          payload: Json
          product_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_guest_purchases_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      claim_webhook_delivery: {
        Args: { p_id: string }
        Returns: {
          attempt_count: number
          created_at: string
          delivery_key: string | null
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          event_type: string
          failed_permanently_at: string | null
          http_status: number | null
          id: string
          max_attempts: number
          next_retry_at: string | null
          payload: Json | null
          response_body: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      classify_attribution_channel: {
        Args: {
          p_campaign: string
          p_click_type: string
          p_medium: string
          p_referrer_host: string
          p_source: string
        }
        Returns: string
      }
      cleanup_application_rate_limits: { Args: never; Returns: number }
      cleanup_audit_logs: { Args: { retention_days?: number }; Returns: number }
      cleanup_captcha_nonces: { Args: never; Returns: number }
      cleanup_expired_oto_coupons: { Args: never; Returns: number }
      cleanup_old_admin_actions: {
        Args: { retention_days?: number }
        Returns: number
      }
      cleanup_old_guest_purchases: {
        Args: { retention_days?: number }
        Returns: number
      }
      cleanup_old_rate_limits: {
        Args: { retention_hours?: number }
        Returns: number
      }
      cleanup_rate_limits: { Args: never; Returns: number }
      clear_admin_cache: { Args: never; Returns: undefined }
      complete_offline_order: {
        Args: { p_paid_minor: number; p_transaction_id: string }
        Returns: Json
      }
      complete_order_payment_attempt: {
        Args: {
          p_amount: number
          p_attempt: string
          p_now: string
          p_payment_intent: string
          p_session_id: string
        }
        Returns: Json
      }
      confirm_event_order: {
        Args: { p_transaction_id: string }
        Returns: undefined
      }
      confirm_lead_submission: {
        Args: { p_email: string; p_token_hash: string }
        Returns: {
          client_consent_text: string | null
          confirmed_at: string | null
          consent_text: string | null
          consent_version: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          marketing_consent: boolean
          product_id: string | null
          product_slug: string | null
          source: string
          token_hash: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_submissions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      confirm_refund_notification: {
        Args: { p_refund_id: string; p_version: number }
        Returns: undefined
      }
      create_refund_request: {
        Args: { reason_param?: string; transaction_id_param: string }
        Returns: Json
      }
      currency_minor_factor: {
        Args: { currency_code: string }
        Returns: number
      }
      declare_transfer: {
        Args: { p_id: string; p_note: string; p_now: string }
        Returns: Json
      }
      enqueue_webhook_delivery: {
        Args: {
          p_delivery_key: string
          p_endpoint_id: string
          p_event_type: string
          p_id: string
          p_max_attempts?: number
          p_payload: Json
        }
        Returns: {
          attempt_count: number
          created_at: string
          delivery_key: string | null
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          event_type: string
          failed_permanently_at: string | null
          http_status: number | null
          id: string
          max_attempts: number
          next_retry_at: string | null
          payload: Json | null
          response_body: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      event_availability: {
        Args: { p_at?: string; p_product_id: string }
        Returns: Json
      }
      event_hold_limits: {
        Args: { p_email: string; p_ip: string; p_session_id: string }
        Returns: boolean
      }
      event_mail_access: {
        Args: {
          p_email: string
          p_product_id: string
          p_transaction_id: string
        }
        Returns: boolean
      }
      event_session_admin: {
        Args: { p_offset?: number; p_session_id: string }
        Returns: Json
      }
      expire_order_payment_attempt: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      expire_seat_reservations: { Args: never; Returns: number }
      find_auto_apply_coupon: {
        Args: { customer_email_param: string; product_id_param: string }
        Returns: Json
      }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      free_grant_context: {
        Args: { p_product_id: string; p_request_id?: string }
        Returns: {
          custom_field_values: Json
          request_id: string
        }[]
      }
      generate_oto_coupon: {
        Args: {
          customer_email_param: string
          source_product_id_param: string
          transaction_id_param?: string
        }
        Returns: Json
      }
      get_abandoned_cart_stats: { Args: { days_ago?: number }; Returns: Json }
      get_abandoned_carts: {
        Args: { days_ago?: number; limit_count?: number }
        Returns: {
          abandoned_at: string
          amount: number
          created_at: string
          currency: string
          customer_email: string
          expires_at: string
          id: string
          metadata: Json
          product_id: string
          product_name: string
        }[]
      }
      get_admin_refund_requests: {
        Args: {
          limit_param?: number
          offset_param?: number
          status_filter?: string
        }
        Returns: {
          admin_id: string
          admin_response: string
          created_at: string
          currency: string
          customer_email: string
          processed_at: string
          product_id: string
          product_name: string
          purchase_date: string
          reason: string
          request_id: string
          requested_amount: number
          status: string
          stripe_payment_intent_id: string
          transaction_id: string
          user_id: string
        }[]
      }
      get_attribution_report: {
        Args: {
          p_from: string
          p_group_by?: string[]
          p_product?: string
          p_to: string
          p_touch?: string
        }
        Returns: Json
      }
      get_checkout_funnel: {
        Args: { p_days?: number; p_product_id?: string }
        Returns: Json
      }
      get_cleanup_job_status: {
        Args: never
        Returns: {
          active: boolean
          command: string
          jobname: string
          last_run: string
          schedule: string
        }[]
      }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_detailed_revenue_stats: {
        Args: { p_goal_start_date?: string; p_product_id?: string }
        Returns: Json
      }
      get_hourly_revenue_stats: {
        Args: {
          p_product_id?: string
          p_target_date?: string
          p_timezone?: string
        }
        Returns: {
          amount_by_currency: Json
          hour: number
          orders: number
        }[]
      }
      get_migration_status: { Args: never; Returns: Json }
      get_oto_coupon_info: {
        Args: { coupon_code_param: string; email_param: string }
        Returns: Json
      }
      get_payment_statistics: {
        Args: { end_date?: string; start_date?: string }
        Returns: Json
      }
      get_product_order_bumps: {
        Args: { product_id_param: string }
        Returns: {
          bump_access_duration: number
          bump_currency: string
          bump_description: string
          bump_id: string
          bump_price: number
          bump_product_description: string
          bump_product_icon: string
          bump_product_id: string
          bump_product_name: string
          bump_title: string
          display_order: number
          original_price: number
          price_includes_vat: boolean
          urgency_duration_minutes: number
          vat_exempt: boolean
          vat_rate: number
        }[]
      }
      get_public_integrations_config: { Args: never; Returns: Json }
      get_revenue_goal: {
        Args: { p_product_id?: string }
        Returns: {
          goal_amount: number
          start_date: string
        }[]
      }
      get_sales_chart_data: {
        Args: {
          p_end_date: string
          p_product_id?: string
          p_start_date: string
        }
        Returns: {
          amount_by_currency: Json
          date: string
          orders: number
        }[]
      }
      get_telemetry_metrics: { Args: never; Returns: Json }
      get_user_payment_history: {
        Args: { user_id_param: string }
        Returns: {
          amount: number
          currency: string
          payment_date: string
          product_name: string
          product_slug: string
          refunded_amount: number
          status: string
          transaction_id: string
        }[]
      }
      get_user_profile: { Args: { user_id_param: string }; Returns: Json }
      get_user_purchases_with_refund_status: {
        Args: { user_id_param?: string }
        Returns: {
          amount: number
          currency: string
          days_since_purchase: number
          is_refundable: boolean
          product_icon: string
          product_id: string
          product_name: string
          product_slug: string
          purchase_date: string
          refund_eligible: boolean
          refund_period_days: number
          refund_request_id: string
          refund_request_status: string
          refunded_amount: number
          status: string
          transaction_id: string
        }[]
      }
      get_variant_group: {
        Args: { p_group_id: string }
        Returns: {
          allow_custom_price: boolean
          currency: string
          custom_price_min: number
          description: string
          display_order: number
          icon: string
          id: string
          image_url: string
          is_active: boolean
          is_featured: boolean
          name: string
          price: number
          sale_price: number
          sale_price_until: string
          sale_quantity_limit: number
          sale_quantity_sold: number
          slug: string
          variant_name: string
        }[]
      }
      get_variant_group_by_slug: {
        Args: { p_slug: string }
        Returns: {
          allow_custom_price: boolean
          currency: string
          custom_price_min: number
          description: string
          display_order: number
          icon: string
          id: string
          image_url: string
          is_active: boolean
          is_featured: boolean
          name: string
          price: number
          sale_price: number
          sale_price_until: string
          sale_quantity_limit: number
          sale_quantity_sold: number
          slug: string
          variant_name: string
        }[]
      }
      grant_bundle_component_access: {
        Args: {
          max_retries?: number
          product_id_param: string
          user_id_param: string
        }
        Returns: Json
      }
      grant_free_product_access: {
        Args: {
          access_duration_days_param?: number
          coupon_code_param?: string
          product_slug_param: string
        }
        Returns: boolean
      }
      grant_free_with_context: {
        Args: {
          coupon_code_param?: string
          p_request_id?: string
          product_slug_param: string
        }
        Returns: boolean
      }
      grant_product_access_service_role: {
        Args: {
          max_retries?: number
          override_duration_days_param?: number
          product_id_param: string
          user_id_param: string
        }
        Returns: Json
      }
      grant_product_and_bundle_components: {
        Args: {
          override_duration_days_param?: number
          product_id_param: string
          user_id_param: string
        }
        Returns: Json
      }
      hold_transfer_for_invoice: {
        Args: { p_id: string; p_now: string }
        Returns: Json
      }
      increment_coupon_usage: {
        Args: { coupon_id_param: string }
        Returns: undefined
      }
      increment_sale_quantity_sold:
        | { Args: { p_product_id: string }; Returns: boolean }
        | {
            Args: { p_product_id: string; p_quantity: number }
            Returns: boolean
          }
      increment_webhook_attempt: {
        Args: {
          p_duration_ms: number
          p_error_message: string
          p_failed_permanently_at: string
          p_http_status: number
          p_log_id: string
          p_next_retry_at: string
          p_response_body: string
          p_status: string
        }
        Returns: undefined
      }
      insert_purchase_attribution: {
        Args: {
          p_coupon: string
          p_kind: string
          p_payload: Json
          p_product: string
          p_tx: string
          p_user: string
        }
        Returns: undefined
      }
      is_admin: { Args: { user_id_param?: string }; Returns: boolean }
      is_admin_cached: { Args: never; Returns: boolean }
      is_free_claimable_product: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      is_free_grantable_now: {
        Args: {
          p_available_from: string
          p_available_until: string
          p_product_type: string
        }
        Returns: boolean
      }
      is_sale_price_active: {
        Args: {
          p_sale_price: number
          p_sale_price_until: string
          p_sale_quantity_limit: number
          p_sale_quantity_sold: number
        }
        Returns: boolean
      }
      jsonschema_subset_matches: {
        Args: { instance: Json; schema: Json }
        Returns: boolean
      }
      jsonschema_subset_pattern: { Args: { pattern: string }; Returns: string }
      jsonschema_subset_walk: {
        Args: { budget: number; depth: number; instance: Json; schema: Json }
        Returns: {
          remaining: number
          valid: boolean
        }[]
      }
      legacy_pending_free_grant_products: {
        Args: never
        Returns: {
          product_id: string
          slug: string
        }[]
      }
      license_event_snapshot: {
        Args: {
          p_license: Database["public"]["Tables"]["issued_licenses"]["Row"]
        }
        Returns: Json
      }
      log_admin_action: {
        Args: {
          action_details?: Json
          action_name: string
          target_id: string
          target_type: string
        }
        Returns: undefined
      }
      log_audit_entry: {
        Args: {
          new_values_param?: Json
          old_values_param?: Json
          operation_param: string
          table_name_param: string
          user_id_param?: string
        }
        Returns: undefined
      }
      logs_monitoring_check: {
        Args: { new_action_details?: Json }
        Returns: undefined
      }
      mark_expired_pending_payments: { Args: never; Returns: number }
      migrate_guest_payment_data_to_profile: {
        Args: { p_user_id: string }
        Returns: Json
      }
      migrate_guest_purchases: {
        Args: { p_email: string; p_user_id: string }
        Returns: number
      }
      mutate_access: {
        Args: {
          p_access_id?: string
          p_action: string
          p_actor?: Json
          p_product_id?: string
          p_user_id: string
          p_values?: Json
        }
        Returns: {
          access_duration_days: number | null
          access_expires_at: string | null
          access_granted_at: string
          created_at: string
          custom_field_values: Json
          expiry_notified_at: string | null
          id: string
          product_id: string
          subscription_id: string | null
          transfer_transaction_id: string | null
          user_id: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "user_product_access"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mutate_product_offer: {
        Args: {
          actor_api_key_id?: string
          actor_method?: string
          actor_user_id?: string
          expected_revision: number
          offer_product_id: string
          operation: string
          restored_from?: number
          validated_config: Json
        }
        Returns: Json
      }
      mutate_product_with_audit: {
        Args: {
          actor_id: string
          operation_param: string
          product_data: Json
          product_id: string
        }
        Returns: {
          allow_custom_price: boolean
          allow_repeat_purchase: boolean
          auto_grant_duration_days: number | null
          available_from: string | null
          available_until: string | null
          billing_interval: string | null
          billing_interval_count: number | null
          checkout_profile: Json | null
          checkout_template: string
          content_config: Json
          content_delivery_type: string
          created_at: string
          currency: string
          custom_checkout_fields: Json
          custom_price_min: number | null
          custom_price_presets: Json | null
          description: string | null
          embed_enabled: boolean
          enable_waitlist: boolean
          event_mode: boolean
          features: Json | null
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_bundle: boolean
          is_featured: boolean
          is_listed: boolean
          is_refundable: boolean
          issue_license_on_purchase: boolean
          layout_template: string
          lead_consent_required: boolean
          lead_consent_text_en: string
          lead_consent_text_pl: string
          lead_consent_version: string
          license_duration_days: number | null
          license_tier: string | null
          long_description: string | null
          marketing_fields: Json
          name: string
          omnibus_exempt: boolean
          pass_params_to_redirect: boolean
          preview_video_config: Json
          preview_video_url: string | null
          price: number
          price_includes_vat: boolean
          product_type: string
          recurring_price: number | null
          refund_period_days: number | null
          sale_price: number | null
          sale_price_until: string | null
          sale_quantity_limit: number | null
          sale_quantity_sold: number
          seller_id: string | null
          show_price_presets: boolean
          slug: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          success_redirect_url: string | null
          thumbnail_url: string | null
          trial_days: number | null
          updated_at: string
          vat_exempt: boolean
          vat_exempt_note: string | null
          vat_rate: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mutate_storefront_config: {
        Args: {
          actor_api_key_id?: string
          actor_method?: string
          actor_user_id?: string
          expected_revision: number
          legacy_source?: Json
          operation: string
          restored_from?: number
          validated_config: Json
        }
        Returns: Json
      }
      my_event_sessions: { Args: { p_product_id: string }; Returns: Json }
      observe_payment_refund: {
        Args: {
          p_amount: number
          p_currency: string
          p_initial_status?: string
          p_refund_id: string
          p_status: string
          p_transaction_id: string
        }
        Returns: {
          notified_version: number
          previous_status: string
          refund_status: string
          refund_version: number
        }[]
      }
      open_order_payment_attempt: {
        Args: {
          p_amount: number
          p_currency: string
          p_expires_at: string
          p_id: string
          p_kind: string
          p_now: string
        }
        Returns: Json
      }
      pending_free_grant_products: {
        Args: never
        Returns: {
          custom_field_values: Json
          product_id: string
          request_id: string
          slug: string
        }[]
      }
      pick_due_webhook_deliveries: {
        Args: { p_limit: number }
        Returns: {
          attempt_count: number
          endpoint_id: string
          event_type: string
          id: string
          max_attempts: number
          payload: Json
        }[]
      }
      place_order: { Args: { p_lines: Json; p_order: Json }; Returns: Json }
      prepare_event_mail: {
        Args: { p_data: Json; p_email: string }
        Returns: undefined
      }
      prepare_free_grant: {
        Args: { p_email: string; p_product_id: string; p_values: Json }
        Returns: string
      }
      process_refund_request: {
        Args: {
          action_param: string
          admin_response_param?: string
          request_id_param: string
        }
        Returns: Json
      }
      process_stripe_payment_completion_with_bump: {
        Args: {
          amount_subtotal_param?: number
          amount_total: number
          bump_product_ids_param?: string[]
          coupon_id_param?: string
          currency_param: string
          customer_email_param: string
          product_id_param: string
          session_id_param: string
          stripe_payment_intent_id?: string
          user_id_param?: string
        }
        Returns: Json
      }
      product_marketing_valid: { Args: { instance: Json }; Returns: boolean }
      product_offer_config_schema: { Args: never; Returns: Json }
      product_offer_config_valid: { Args: { config: Json }; Returns: boolean }
      public_event_availability: {
        Args: { p_product_id: string }
        Returns: Json
      }
      purge_attribution_click_ids: { Args: never; Returns: number }
      queue_pending_free_grant: {
        Args: { p_email: string; p_product_slug: string }
        Returns: boolean
      }
      record_free_attribution: {
        Args: { p_payload: Json; p_product: string; p_user: string }
        Returns: undefined
      }
      record_free_attribution_from_ref: {
        Args: { p_product: string; p_ref: string; p_user: string }
        Returns: undefined
      }
      record_order_payment_refund: {
        Args: { p_attempt: string; p_refund_id: string }
        Returns: undefined
      }
      record_template_credential_status: {
        Args: {
          checked_at: string
          expected_iv: string
          expected_key: string
          expected_tag: string
          template_id: string
          verification_state: string
        }
        Returns: boolean
      }
      release_unpaid_transfer: {
        Args: { p_id: string; p_now: string }
        Returns: Json
      }
      revoke_issued_licenses: {
        Args: { p_actor?: string; p_license_ids: string[] }
        Returns: {
          changed: boolean
          id: string
        }[]
      }
      rotate_webhook_secret: {
        Args: {
          p_actor_id: string
          p_api_key_id?: string
          p_endpoint_id: string
          p_secret: string
        }
        Returns: boolean
      }
      save_attribution_config: {
        Args: { p_retention_days: number; p_rules: Json }
        Returns: Json
      }
      save_bank_transfer_config: {
        Args: { p_actor: string; p_config: Json }
        Returns: undefined
      }
      save_template_credential: {
        Args: {
          actor_api_key_id?: string
          actor_method?: string
          actor_user_id?: string
          encrypted_key: string
          encryption_iv: string
          encryption_tag: string
          template_id: string
        }
        Returns: Json
      }
      seller_license_public_keys: {
        Args: { seller: string }
        Returns: {
          alg: string
          kid: string
          public_key: string
        }[]
      }
      seller_revoked_orders: {
        Args: { hash_prefix: string; seller: string }
        Returns: {
          order_hash: string
        }[]
      }
      send_monitoring_email: {
        Args: { alert_details: Json; alert_type: string }
        Returns: undefined
      }
      set_payment_order_buyer: {
        Args: {
          p_buyer: Json
          p_only_if_missing?: boolean
          p_payment_intent_id?: string
          p_session_id?: string
        }
        Returns: number
      }
      set_payment_order_details: {
        Args: {
          p_details: Json
          p_payment_intent_id?: string
          p_product_id: string
          p_quantity: number
          p_session_id?: string
        }
        Returns: number
      }
      set_revenue_goal: {
        Args: {
          p_goal_amount: number
          p_product_id?: string
          p_start_date: string
        }
        Returns: undefined
      }
      set_webhook_endpoint_scoping: {
        Args: { p_endpoint_id: string; p_mode: string; p_product_ids: string[] }
        Returns: undefined
      }
      store_checkout_attribution: {
        Args: { p_payload: Json; p_ref: string }
        Returns: undefined
      }
      storefront_catalogue_boundary: { Args: never; Returns: string }
      storefront_catalogue_categories: {
        Args: { category_ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      storefront_catalogue_page: {
        Args: {
          after_created?: string
          after_id?: string
          filters?: Json
          product_ids?: string[]
        }
        Returns: Json[]
      }
      storefront_config_schema: { Args: never; Returns: Json }
      storefront_config_stored_bytes: {
        Args: { config: Json }
        Returns: number
      }
      storefront_config_valid: { Args: { config: Json }; Returns: boolean }
      telemetry_claim_send: {
        Args: { p_lease_ms: number; p_window_ms: number }
        Returns: {
          instance_id: string
          report_id: string
        }[]
      }
      telemetry_confirm_send: { Args: never; Returns: undefined }
      update_video_progress: {
        Args: {
          completed_param?: boolean
          duration_param?: number
          position_param: number
          product_id_param: string
          video_id_param: string
        }
        Returns: Json
      }
      validate_email_format: { Args: { email_param: string }; Returns: boolean }
      validate_payment_transaction: {
        Args: { transaction_id: string }
        Returns: boolean
      }
      verify_api_key: {
        Args: { p_key_hash: string }
        Returns: {
          admin_user_id: string
          is_valid: boolean
          key_id: string
          rate_limit_per_minute: number
          rejection_reason: string
          scopes: Json
        }[]
      }
      verify_coupon: {
        Args: {
          code_param: string
          currency_param?: string
          customer_email_param?: string
          product_id_param: string
        }
        Returns: Json
      }
    }
    Enums: {
      line_item_type: "main_product" | "order_bump"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      line_item_type: ["main_product", "order_bump"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

