export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _migration_history: {
        Row: {
          applied_at: string
          applied_by: string
          checksum: string | null
          execution_ms: number | null
          version: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string
          checksum?: string | null
          execution_ms?: number | null
          version: string
        }
        Update: {
          applied_at?: string
          applied_by?: string
          checksum?: string | null
          execution_ms?: number | null
          version?: string
        }
        Relationships: []
      }
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
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
            referencedRelation: "user_access_stats"
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
      sellers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          platform_fee_percent: number
          schema_name: string
          slug: string
          status: string
          stripe_account_id: string | null
          stripe_onboarding_complete: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          platform_fee_percent?: number
          schema_name: string
          slug: string
          status?: string
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          platform_fee_percent?: number
          schema_name?: string
          slug?: string
          status?: string
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sellers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
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
    }
    Views: {
      categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string | null
          name: string | null
          parent_id: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          slug?: string | null
          updated_at?: string | null
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
      consent_logs: {
        Row: {
          anonymous_id: string | null
          consent_version: string | null
          consents: Json | null
          created_at: string | null
          id: string | null
          ip_address: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          consent_version?: string | null
          consents?: Json | null
          created_at?: string | null
          id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          consent_version?: string | null
          consents?: Json | null
          created_at?: string | null
          id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string | null
          customer_email: string | null
          discount_amount: number | null
          id: string | null
          redeemed_at: string | null
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          coupon_id?: string | null
          customer_email?: string | null
          discount_amount?: number | null
          id?: string | null
          redeemed_at?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          coupon_id?: string | null
          customer_email?: string | null
          discount_amount?: number | null
          id?: string | null
          redeemed_at?: string | null
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      coupon_reservations: {
        Row: {
          coupon_id: string | null
          customer_email: string | null
          expires_at: string | null
          id: string | null
          reserved_at: string | null
          session_id: string | null
        }
        Insert: {
          coupon_id?: string | null
          customer_email?: string | null
          expires_at?: string | null
          id?: string | null
          reserved_at?: string | null
          session_id?: string | null
        }
        Update: {
          coupon_id?: string | null
          customer_email?: string | null
          expires_at?: string | null
          id?: string | null
          reserved_at?: string | null
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
          allowed_emails: Json | null
          allowed_product_ids: Json | null
          code: string | null
          created_at: string | null
          currency: string | null
          current_usage_count: number | null
          discount_type: string | null
          discount_value: number | null
          exclude_order_bumps: boolean | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          is_oto_coupon: boolean | null
          is_public: boolean | null
          name: string | null
          oto_offer_id: string | null
          source_transaction_id: string | null
          starts_at: string | null
          updated_at: string | null
          usage_limit_global: number | null
          usage_limit_per_user: number | null
        }
        Insert: {
          allowed_emails?: Json | null
          allowed_product_ids?: Json | null
          code?: string | null
          created_at?: string | null
          currency?: string | null
          current_usage_count?: number | null
          discount_type?: string | null
          discount_value?: number | null
          exclude_order_bumps?: boolean | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_oto_coupon?: boolean | null
          is_public?: boolean | null
          name?: string | null
          oto_offer_id?: string | null
          source_transaction_id?: string | null
          starts_at?: string | null
          updated_at?: string | null
          usage_limit_global?: number | null
          usage_limit_per_user?: number | null
        }
        Update: {
          allowed_emails?: Json | null
          allowed_product_ids?: Json | null
          code?: string | null
          created_at?: string | null
          currency?: string | null
          current_usage_count?: number | null
          discount_type?: string | null
          discount_value?: number | null
          exclude_order_bumps?: boolean | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_oto_coupon?: boolean | null
          is_public?: boolean | null
          name?: string | null
          oto_offer_id?: string | null
          source_transaction_id?: string | null
          starts_at?: string | null
          updated_at?: string | null
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
          category: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          script_content: string | null
          script_location: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          script_content?: string | null
          script_location?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          script_content?: string | null
          script_location?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      guest_purchases: {
        Row: {
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string | null
          customer_email: string | null
          id: string | null
          metadata: Json | null
          product_id: string | null
          session_id: string | null
          transaction_amount: number | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string | null
          customer_email?: string | null
          id?: string | null
          metadata?: Json | null
          product_id?: string | null
          session_id?: string | null
          transaction_amount?: number | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string | null
          customer_email?: string | null
          id?: string | null
          metadata?: Json | null
          product_id?: string | null
          session_id?: string | null
          transaction_amount?: number | null
        }
        Relationships: [
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
        ]
      }
      integrations_config: {
        Row: {
          consent_logging_enabled: boolean | null
          cookie_consent_enabled: boolean | null
          created_at: string | null
          currency_api_enabled: boolean | null
          currency_api_key_encrypted: string | null
          currency_api_key_iv: string | null
          currency_api_key_tag: string | null
          currency_api_provider: string | null
          facebook_capi_token: string | null
          facebook_pixel_id: string | null
          facebook_test_event_code: string | null
          fb_capi_enabled: boolean | null
          google_ads_conversion_id: string | null
          google_ads_conversion_label: string | null
          gtm_container_id: string | null
          gtm_server_container_url: string | null
          gtm_ss_enabled: boolean | null
          gus_api_enabled: boolean | null
          gus_api_key_encrypted: string | null
          gus_api_key_iv: string | null
          gus_api_key_tag: string | null
          id: number | null
          sellf_license: string | null
          send_conversions_without_consent: boolean | null
          umami_script_url: string | null
          umami_website_id: string | null
          updated_at: string | null
        }
        Insert: {
          consent_logging_enabled?: boolean | null
          cookie_consent_enabled?: boolean | null
          created_at?: string | null
          currency_api_enabled?: boolean | null
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
          facebook_pixel_id?: string | null
          facebook_test_event_code?: string | null
          fb_capi_enabled?: boolean | null
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          gtm_container_id?: string | null
          gtm_server_container_url?: string | null
          gtm_ss_enabled?: boolean | null
          gus_api_enabled?: boolean | null
          gus_api_key_encrypted?: string | null
          gus_api_key_iv?: string | null
          gus_api_key_tag?: string | null
          id?: number | null
          sellf_license?: string | null
          send_conversions_without_consent?: boolean | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string | null
        }
        Update: {
          consent_logging_enabled?: boolean | null
          cookie_consent_enabled?: boolean | null
          created_at?: string | null
          currency_api_enabled?: boolean | null
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
          facebook_pixel_id?: string | null
          facebook_test_event_code?: string | null
          fb_capi_enabled?: boolean | null
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          gtm_container_id?: string | null
          gtm_server_container_url?: string | null
          gtm_ss_enabled?: boolean | null
          gus_api_enabled?: boolean | null
          gus_api_key_encrypted?: string | null
          gus_api_key_iv?: string | null
          gus_api_key_tag?: string | null
          id?: number | null
          sellf_license?: string | null
          send_conversions_without_consent?: boolean | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      order_bumps: {
        Row: {
          access_duration_days: number | null
          bump_description: string | null
          bump_price: number | null
          bump_product_id: string | null
          bump_title: string | null
          created_at: string | null
          display_order: number | null
          id: string | null
          is_active: boolean | null
          main_product_id: string | null
          updated_at: string | null
          urgency_duration_minutes: number | null
        }
        Insert: {
          access_duration_days?: number | null
          bump_description?: string | null
          bump_price?: number | null
          bump_product_id?: string | null
          bump_title?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          main_product_id?: string | null
          updated_at?: string | null
          urgency_duration_minutes?: number | null
        }
        Update: {
          access_duration_days?: number | null
          bump_description?: string | null
          bump_price?: number | null
          bump_product_id?: string | null
          bump_title?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          is_active?: boolean | null
          main_product_id?: string | null
          updated_at?: string | null
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
      oto_offers: {
        Row: {
          created_at: string | null
          discount_type: string | null
          discount_value: number | null
          display_order: number | null
          duration_minutes: number | null
          id: string | null
          is_active: boolean | null
          oto_product_id: string | null
          source_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          display_order?: number | null
          duration_minutes?: number | null
          id?: string | null
          is_active?: boolean | null
          oto_product_id?: string | null
          source_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          display_order?: number | null
          duration_minutes?: number | null
          id?: string | null
          is_active?: boolean | null
          oto_product_id?: string | null
          source_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
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
      payment_line_items: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string | null
          item_type: Database["seller_main"]["Enums"]["line_item_type"] | null
          metadata: Json | null
          order_bump_id: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          total_price: number | null
          transaction_id: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string | null
          item_type?: Database["seller_main"]["Enums"]["line_item_type"] | null
          metadata?: Json | null
          order_bump_id?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          total_price?: number | null
          transaction_id?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string | null
          item_type?: Database["seller_main"]["Enums"]["line_item_type"] | null
          metadata?: Json | null
          order_bump_id?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          total_price?: number | null
          transaction_id?: string | null
          unit_price?: number | null
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
          config_mode: string | null
          created_at: string | null
          currency_overrides: Json | null
          custom_payment_methods: Json | null
          enable_apple_pay: boolean | null
          enable_express_checkout: boolean | null
          enable_google_pay: boolean | null
          enable_link: boolean | null
          id: number | null
          last_modified_by: string | null
          payment_method_order: Json | null
          stripe_pmc_id: string | null
          stripe_pmc_last_synced: string | null
          stripe_pmc_name: string | null
          updated_at: string | null
        }
        Insert: {
          available_payment_methods?: Json | null
          config_mode?: string | null
          created_at?: string | null
          currency_overrides?: Json | null
          custom_payment_methods?: Json | null
          enable_apple_pay?: boolean | null
          enable_express_checkout?: boolean | null
          enable_google_pay?: boolean | null
          enable_link?: boolean | null
          id?: number | null
          last_modified_by?: string | null
          payment_method_order?: Json | null
          stripe_pmc_id?: string | null
          stripe_pmc_last_synced?: string | null
          stripe_pmc_name?: string | null
          updated_at?: string | null
        }
        Update: {
          available_payment_methods?: Json | null
          config_mode?: string | null
          created_at?: string | null
          currency_overrides?: Json | null
          custom_payment_methods?: Json | null
          enable_apple_pay?: boolean | null
          enable_express_checkout?: boolean | null
          enable_google_pay?: boolean | null
          enable_link?: boolean | null
          id?: number | null
          last_modified_by?: string | null
          payment_method_order?: Json | null
          stripe_pmc_id?: string | null
          stripe_pmc_last_synced?: string | null
          stripe_pmc_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_config_last_modified_by_fkey"
            columns: ["last_modified_by"]
            isOneToOne: false
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
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
      payment_transactions: {
        Row: {
          abandoned_at: string | null
          amount: number | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          expires_at: string | null
          id: string | null
          metadata: Json | null
          product_id: string | null
          refund_id: string | null
          refund_reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          refunded_by: string | null
          session_id: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          abandoned_at?: string | null
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          expires_at?: string | null
          id?: string | null
          metadata?: Json | null
          product_id?: string | null
          refund_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          session_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          abandoned_at?: string | null
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          expires_at?: string | null
          id?: string | null
          metadata?: Json | null
          product_id?: string | null
          refund_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          session_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
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
            referencedRelation: "user_access_stats"
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
          category_id: string | null
          created_at: string | null
          product_id: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          product_id?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          product_id?: string | null
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
      product_price_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string | null
          currency: string | null
          effective_from: string | null
          effective_until: string | null
          id: string | null
          price: number | null
          price_includes_vat: boolean | null
          product_id: string | null
          sale_price: number | null
          vat_rate: number | null
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          currency?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string | null
          price?: number | null
          price_includes_vat?: boolean | null
          product_id?: string | null
          sale_price?: number | null
          vat_rate?: number | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          currency?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string | null
          price?: number | null
          price_includes_vat?: boolean | null
          product_id?: string | null
          sale_price?: number | null
          vat_rate?: number | null
        }
        Relationships: [
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
      product_tags: {
        Row: {
          created_at: string | null
          product_id: string | null
          tag_id: string | null
        }
        Insert: {
          created_at?: string | null
          product_id?: string | null
          tag_id?: string | null
        }
        Update: {
          created_at?: string | null
          product_id?: string | null
          tag_id?: string | null
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
          created_at: string | null
          display_order: number | null
          group_id: string | null
          id: string | null
          is_featured: boolean | null
          product_id: string | null
          variant_name: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          group_id?: string | null
          id?: string | null
          is_featured?: boolean | null
          product_id?: string | null
          variant_name?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          group_id?: string | null
          id?: string | null
          is_featured?: boolean | null
          product_id?: string | null
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
          allow_custom_price: boolean | null
          auto_grant_duration_days: number | null
          available_from: string | null
          available_until: string | null
          content_config: Json | null
          content_delivery_type: string | null
          created_at: string | null
          currency: string | null
          custom_price_min: number | null
          custom_price_presets: Json | null
          description: string | null
          enable_waitlist: boolean | null
          features: Json | null
          icon: string | null
          id: string | null
          image_url: string | null
          is_active: boolean | null
          is_featured: boolean | null
          is_listed: boolean | null
          is_refundable: boolean | null
          layout_template: string | null
          long_description: string | null
          name: string | null
          omnibus_exempt: boolean | null
          pass_params_to_redirect: boolean | null
          preview_video_url: string | null
          price: number | null
          price_includes_vat: boolean | null
          refund_period_days: number | null
          sale_price: number | null
          sale_price_until: string | null
          sale_quantity_limit: number | null
          sale_quantity_sold: number | null
          show_price_presets: boolean | null
          slug: string | null
          success_redirect_url: string | null
          thumbnail_url: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          allow_custom_price?: boolean | null
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          content_config?: Json | null
          content_delivery_type?: string | null
          created_at?: string | null
          currency?: string | null
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          enable_waitlist?: boolean | null
          features?: Json | null
          icon?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_featured?: boolean | null
          is_listed?: boolean | null
          is_refundable?: boolean | null
          layout_template?: string | null
          long_description?: string | null
          name?: string | null
          omnibus_exempt?: boolean | null
          pass_params_to_redirect?: boolean | null
          preview_video_url?: string | null
          price?: number | null
          price_includes_vat?: boolean | null
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number | null
          show_price_presets?: boolean | null
          slug?: string | null
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          allow_custom_price?: boolean | null
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          content_config?: Json | null
          content_delivery_type?: string | null
          created_at?: string | null
          currency?: string | null
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          enable_waitlist?: boolean | null
          features?: Json | null
          icon?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          is_featured?: boolean | null
          is_listed?: boolean | null
          is_refundable?: boolean | null
          layout_template?: string | null
          long_description?: string | null
          name?: string | null
          omnibus_exempt?: boolean | null
          pass_params_to_redirect?: boolean | null
          preview_video_url?: string | null
          price?: number | null
          price_includes_vat?: boolean | null
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number | null
          show_price_presets?: boolean | null
          slug?: string | null
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string | null
          display_name: string | null
          first_name: string | null
          full_name: string | null
          id: string | null
          last_name: string | null
          preferred_language: string | null
          state: string | null
          tax_id: string | null
          timezone: string | null
          updated_at: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          display_name?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          last_name?: string | null
          preferred_language?: string | null
          state?: string | null
          tax_id?: string | null
          timezone?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          display_name?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          last_name?: string | null
          preferred_language?: string | null
          state?: string | null
          tax_id?: string | null
          timezone?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
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
      refund_requests: {
        Row: {
          admin_id: string | null
          admin_response: string | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          id: string | null
          processed_at: string | null
          product_id: string | null
          reason: string | null
          requested_amount: number | null
          status: string | null
          transaction_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          admin_id?: string | null
          admin_response?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          id?: string | null
          processed_at?: string | null
          product_id?: string | null
          reason?: string | null
          requested_amount?: number | null
          status?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          admin_id?: string | null
          admin_response?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          id?: string | null
          processed_at?: string | null
          product_id?: string | null
          reason?: string | null
          requested_amount?: number | null
          status?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      revenue_goals: {
        Row: {
          created_at: string | null
          goal_amount: number | null
          id: string | null
          product_id: string | null
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          goal_amount?: number | null
          id?: string | null
          product_id?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          goal_amount?: number | null
          id?: string | null
          product_id?: string | null
          start_date?: string | null
          updated_at?: string | null
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
      shop_config: {
        Row: {
          automatic_tax_enabled: boolean | null
          checkout_billing_address: string | null
          checkout_collect_terms: boolean | null
          checkout_expires_hours: number | null
          checkout_theme: string | null
          contact_email: string | null
          created_at: string | null
          custom_settings: Json | null
          default_currency: string | null
          font_family: string | null
          id: string | null
          logo_url: string | null
          omnibus_enabled: boolean | null
          privacy_policy_url: string | null
          shop_name: string | null
          stripe_tax_rate_cache: Json | null
          tax_id_collection_enabled: boolean | null
          tax_mode: string | null
          tax_rate: number | null
          terms_of_service_url: string | null
          updated_at: string | null
        }
        Insert: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          contact_email?: string | null
          created_at?: string | null
          custom_settings?: Json | null
          default_currency?: string | null
          font_family?: string | null
          id?: string | null
          logo_url?: string | null
          omnibus_enabled?: boolean | null
          privacy_policy_url?: string | null
          shop_name?: string | null
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string | null
        }
        Update: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          contact_email?: string | null
          created_at?: string | null
          custom_settings?: Json | null
          default_currency?: string | null
          font_family?: string | null
          id?: string | null
          logo_url?: string | null
          omnibus_enabled?: boolean | null
          privacy_policy_url?: string | null
          shop_name?: string | null
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      stripe_configurations: {
        Row: {
          account_id: string | null
          created_at: string | null
          encrypted_key: string | null
          encryption_iv: string | null
          encryption_tag: string | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          key_last_4: string | null
          key_prefix: string | null
          last_validated_at: string | null
          mode: string | null
          permissions_verified: boolean | null
          rotation_reminder_sent: boolean | null
          updated_at: string | null
          webhook_endpoint_id: string | null
          webhook_signing_iv: string | null
          webhook_signing_secret_enc: string | null
          webhook_signing_tag: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          encrypted_key?: string | null
          encryption_iv?: string | null
          encryption_tag?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          key_last_4?: string | null
          key_prefix?: string | null
          last_validated_at?: string | null
          mode?: string | null
          permissions_verified?: boolean | null
          rotation_reminder_sent?: boolean | null
          updated_at?: string | null
          webhook_endpoint_id?: string | null
          webhook_signing_iv?: string | null
          webhook_signing_secret_enc?: string | null
          webhook_signing_tag?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          encrypted_key?: string | null
          encryption_iv?: string | null
          encryption_tag?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          key_last_4?: string | null
          key_prefix?: string | null
          last_validated_at?: string | null
          mode?: string | null
          permissions_verified?: boolean | null
          rotation_reminder_sent?: boolean | null
          updated_at?: string | null
          webhook_endpoint_id?: string | null
          webhook_signing_iv?: string | null
          webhook_signing_secret_enc?: string | null
          webhook_signing_tag?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
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
      user_product_access: {
        Row: {
          access_duration_days: number | null
          access_expires_at: string | null
          access_granted_at: string | null
          created_at: string | null
          expiry_notified_at: string | null
          id: string | null
          product_id: string | null
          user_id: string | null
          version: number | null
        }
        Insert: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string | null
          created_at?: string | null
          expiry_notified_at?: string | null
          id?: string | null
          product_id?: string | null
          user_id?: string | null
          version?: number | null
        }
        Update: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string | null
          created_at?: string | null
          expiry_notified_at?: string | null
          id?: string | null
          product_id?: string | null
          user_id?: string | null
          version?: number | null
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      variant_groups: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      video_events: {
        Row: {
          created_at: string | null
          event_type: string | null
          id: string | null
          position_seconds: number | null
          progress_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          position_seconds?: number | null
          progress_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          position_seconds?: number | null
          progress_id?: string | null
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
          created_at: string | null
          id: string | null
          is_completed: boolean | null
          last_position_seconds: number | null
          max_position_seconds: number | null
          product_id: string | null
          updated_at: string | null
          user_id: string | null
          video_duration_seconds: number | null
          video_id: string | null
          view_count: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_completed?: boolean | null
          last_position_seconds?: number | null
          max_position_seconds?: number | null
          product_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          video_duration_seconds?: number | null
          video_id?: string | null
          view_count?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_completed?: boolean | null
          last_position_seconds?: number | null
          max_position_seconds?: number | null
          product_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          video_duration_seconds?: number | null
          video_id?: string | null
          view_count?: number | null
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string | null
          description: string | null
          events: string[] | null
          id: string | null
          is_active: boolean | null
          secret: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          events?: string[] | null
          id?: string | null
          is_active?: boolean | null
          secret?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          events?: string[] | null
          id?: string | null
          is_active?: boolean | null
          secret?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          event_type: string | null
          http_status: number | null
          id: string | null
          payload: Json | null
          response_body: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type?: string | null
          http_status?: number | null
          id?: string | null
          payload?: Json | null
          response_body?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type?: string | null
          http_status?: number | null
          id?: string | null
          payload?: Json | null
          response_body?: string | null
          status?: string | null
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
    Functions: {
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
          duration_minutes_param?: number
          is_active_param?: boolean
          oto_product_id_param: string
          source_product_id_param: string
        }
        Returns: Json
      }
      apply_migration: {
        Args: {
          content_checksum: string
          migration_sql: string
          migration_version: string
        }
        Returns: Json
      }
      batch_check_user_product_access: {
        Args: { product_slugs_param: string[] }
        Returns: Json
      }
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
      claim_guest_purchases_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      cleanup_application_rate_limits: { Args: never; Returns: number }
      cleanup_audit_logs: { Args: { retention_days?: number }; Returns: number }
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
      clone_schema: {
        Args: {
          arr?: Database["public"]["Enums"]["cloneparms"][]
          dest_schema: string
          source_schema: string
        }
        Returns: number
      }
      create_refund_request: {
        Args: { reason_param?: string; transaction_id_param: string }
        Returns: Json
      }
      deprovision_seller_schema: {
        Args: { p_hard_delete?: boolean; p_seller_id: string }
        Returns: boolean
      }
      find_auto_apply_coupon: {
        Args: { customer_email_param: string; product_id_param: string }
        Returns: Json
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
        Args: { p_product_id?: string; p_target_date?: string }
        Returns: {
          amount_by_currency: Json
          hour: number
          orders: number
        }[]
      }
      get_insert_stmt_ddl: {
        Args: {
          atable: string
          bidentity?: boolean
          btextcast?: boolean
          source_schema: string
          target_schema: string
        }
        Returns: string
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
          urgency_duration_minutes: number
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
          slug: string
          variant_name: string
        }[]
      }
      grant_free_product_access: {
        Args: {
          access_duration_days_param?: number
          product_slug_param: string
        }
        Returns: boolean
      }
      grant_product_access_service_role: {
        Args: {
          max_retries?: number
          product_id_param: string
          user_id_param: string
        }
        Returns: Json
      }
      grant_pwyw_free_access: {
        Args: {
          access_duration_days_param?: number
          product_slug_param: string
        }
        Returns: boolean
      }
      increment_coupon_usage: {
        Args: { coupon_id_param: string }
        Returns: undefined
      }
      increment_sale_quantity_sold: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      is_admin: { Args: { user_id_param?: string }; Returns: boolean }
      is_admin_cached: { Args: never; Returns: boolean }
      is_sale_price_active: {
        Args: {
          p_sale_price: number
          p_sale_price_until: string
          p_sale_quantity_limit: number
          p_sale_quantity_sold: number
        }
        Returns: boolean
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
      pg_get_coldef: {
        Args: {
          in_column: string
          in_schema: string
          in_table: string
          oldway?: boolean
        }
        Returns: string
      }
      pg_get_tabledef: {
        Args: {
          _verbose: boolean
          arr?: Database["public"]["Enums"]["tabledefs"][]
          in_schema: string
          in_table: string
        }
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
      process_stripe_payment_completion: {
        Args: {
          amount_total: number
          currency_param: string
          customer_email_param: string
          product_id_param: string
          session_id_param: string
          stripe_payment_intent_id?: string
          user_id_param?: string
        }
        Returns: Json
      }
      process_stripe_payment_completion_with_bump: {
        Args: {
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
      provision_seller_schema: {
        Args: {
          p_display_name: string
          p_owner_user_id?: string
          p_slug: string
        }
        Returns: string
      }
      send_monitoring_email: {
        Args: { alert_details: Json; alert_type: string }
        Returns: undefined
      }
      set_revenue_goal: {
        Args: {
          p_goal_amount: number
          p_product_id?: string
          p_start_date: string
        }
        Returns: undefined
      }
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
      cloneparms:
        | "DATA"
        | "NODATA"
        | "DDLONLY"
        | "NOOWNER"
        | "NOACL"
        | "VERBOSE"
        | "DEBUG"
        | "FILECOPY"
        | "DEBUGEXEC"
      tabledefs:
        | "PKEY_INTERNAL"
        | "PKEY_EXTERNAL"
        | "FKEYS_INTERNAL"
        | "FKEYS_EXTERNAL"
        | "COMMENTS"
        | "FKEYS_NONE"
        | "INCLUDE_TRIGGERS"
        | "NO_TRIGGERS"
        | "SHOWPARTS"
        | "ACL_OWNER"
        | "ACL_DCL"
        | "ACL_POLICIES"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  seller_main: {
    Tables: {
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
          created_at: string
          currency: string | null
          current_usage_count: number
          discount_type: string
          discount_value: number
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
          created_at?: string
          currency?: string | null
          current_usage_count?: number
          discount_type: string
          discount_value: number
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
          created_at?: string
          currency?: string | null
          current_usage_count?: number
          discount_type?: string
          discount_value?: number
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
      guest_purchases: {
        Row: {
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          customer_email: string
          id: string
          metadata: Json
          product_id: string
          session_id: string
          transaction_amount: number
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          customer_email: string
          id?: string
          metadata?: Json
          product_id: string
          session_id: string
          transaction_amount: number
        }
        Update: {
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          customer_email?: string
          id?: string
          metadata?: Json
          product_id?: string
          session_id?: string
          transaction_amount?: number
        }
        Relationships: [
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
        ]
      }
      integrations_config: {
        Row: {
          consent_logging_enabled: boolean | null
          cookie_consent_enabled: boolean | null
          created_at: string
          currency_api_enabled: boolean
          currency_api_key_encrypted: string | null
          currency_api_key_iv: string | null
          currency_api_key_tag: string | null
          currency_api_provider: string | null
          facebook_capi_token: string | null
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
          send_conversions_without_consent: boolean | null
          umami_script_url: string | null
          umami_website_id: string | null
          updated_at: string
        }
        Insert: {
          consent_logging_enabled?: boolean | null
          cookie_consent_enabled?: boolean | null
          created_at?: string
          currency_api_enabled?: boolean
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
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
          send_conversions_without_consent?: boolean | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string
        }
        Update: {
          consent_logging_enabled?: boolean | null
          cookie_consent_enabled?: boolean | null
          created_at?: string
          currency_api_enabled?: boolean
          currency_api_key_encrypted?: string | null
          currency_api_key_iv?: string | null
          currency_api_key_tag?: string | null
          currency_api_provider?: string | null
          facebook_capi_token?: string | null
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
          send_conversions_without_consent?: boolean | null
          umami_script_url?: string | null
          umami_website_id?: string | null
          updated_at?: string
        }
        Relationships: []
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
      oto_offers: {
        Row: {
          created_at: string
          discount_type: string
          discount_value: number
          display_order: number
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
          duration_minutes?: number
          id?: string
          is_active?: boolean
          oto_product_id?: string
          source_product_id?: string
          updated_at?: string
        }
        Relationships: [
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
      payment_line_items: {
        Row: {
          created_at: string
          currency: string
          id: string
          item_type: Database["seller_main"]["Enums"]["line_item_type"]
          metadata: Json
          order_bump_id: string | null
          product_id: string
          product_name: string | null
          quantity: number
          total_price: number
          transaction_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          currency: string
          id?: string
          item_type: Database["seller_main"]["Enums"]["line_item_type"]
          metadata?: Json
          order_bump_id?: string | null
          product_id: string
          product_name?: string | null
          quantity?: number
          total_price: number
          transaction_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          item_type?: Database["seller_main"]["Enums"]["line_item_type"]
          metadata?: Json
          order_bump_id?: string | null
          product_id?: string
          product_name?: string | null
          quantity?: number
          total_price?: number
          transaction_id?: string
          unit_price?: number
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          abandoned_at: string | null
          amount: number
          created_at: string
          currency: string
          customer_email: string
          expires_at: string | null
          id: string
          metadata: Json
          product_id: string
          refund_id: string | null
          refund_reason: string | null
          refunded_amount: number | null
          refunded_at: string | null
          refunded_by: string | null
          session_id: string
          status: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          abandoned_at?: string | null
          amount: number
          created_at?: string
          currency: string
          customer_email: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          product_id: string
          refund_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          session_id: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          abandoned_at?: string | null
          amount?: number
          created_at?: string
          currency?: string
          customer_email?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          product_id?: string
          refund_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunded_by?: string | null
          session_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
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
            referencedRelation: "user_access_stats"
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
          auto_grant_duration_days: number | null
          available_from: string | null
          available_until: string | null
          content_config: Json
          content_delivery_type: string
          created_at: string
          currency: string
          custom_price_min: number | null
          custom_price_presets: Json | null
          description: string | null
          enable_waitlist: boolean
          features: Json | null
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_featured: boolean
          is_listed: boolean
          is_refundable: boolean
          layout_template: string
          long_description: string | null
          name: string
          omnibus_exempt: boolean
          pass_params_to_redirect: boolean
          preview_video_url: string | null
          price: number
          price_includes_vat: boolean
          refund_period_days: number | null
          sale_price: number | null
          sale_price_until: string | null
          sale_quantity_limit: number | null
          sale_quantity_sold: number
          show_price_presets: boolean
          slug: string
          success_redirect_url: string | null
          thumbnail_url: string | null
          updated_at: string
          vat_rate: number | null
        }
        Insert: {
          allow_custom_price?: boolean
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          content_config?: Json
          content_delivery_type?: string
          created_at?: string
          currency?: string
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          enable_waitlist?: boolean
          features?: Json | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_listed?: boolean
          is_refundable?: boolean
          layout_template?: string
          long_description?: string | null
          name: string
          omnibus_exempt?: boolean
          pass_params_to_redirect?: boolean
          preview_video_url?: string | null
          price?: number
          price_includes_vat?: boolean
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number
          show_price_presets?: boolean
          slug: string
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          vat_rate?: number | null
        }
        Update: {
          allow_custom_price?: boolean
          auto_grant_duration_days?: number | null
          available_from?: string | null
          available_until?: string | null
          content_config?: Json
          content_delivery_type?: string
          created_at?: string
          currency?: string
          custom_price_min?: number | null
          custom_price_presets?: Json | null
          description?: string | null
          enable_waitlist?: boolean
          features?: Json | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_listed?: boolean
          is_refundable?: boolean
          layout_template?: string
          long_description?: string | null
          name?: string
          omnibus_exempt?: boolean
          pass_params_to_redirect?: boolean
          preview_video_url?: string | null
          price?: number
          price_includes_vat?: boolean
          refund_period_days?: number | null
          sale_price?: number | null
          sale_price_until?: string | null
          sale_quantity_limit?: number | null
          sale_quantity_sold?: number
          show_price_presets?: boolean
          slug?: string
          success_redirect_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          vat_rate?: number | null
        }
        Relationships: []
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
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
      shop_config: {
        Row: {
          automatic_tax_enabled: boolean | null
          checkout_billing_address: string | null
          checkout_collect_terms: boolean | null
          checkout_expires_hours: number | null
          checkout_theme: string | null
          contact_email: string | null
          created_at: string
          custom_settings: Json | null
          default_currency: string
          font_family: string | null
          id: string
          logo_url: string | null
          omnibus_enabled: boolean
          privacy_policy_url: string | null
          shop_name: string
          stripe_tax_rate_cache: Json | null
          tax_id_collection_enabled: boolean | null
          tax_mode: string | null
          tax_rate: number | null
          terms_of_service_url: string | null
          updated_at: string
        }
        Insert: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          contact_email?: string | null
          created_at?: string
          custom_settings?: Json | null
          default_currency?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          omnibus_enabled?: boolean
          privacy_policy_url?: string | null
          shop_name?: string
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string
        }
        Update: {
          automatic_tax_enabled?: boolean | null
          checkout_billing_address?: string | null
          checkout_collect_terms?: boolean | null
          checkout_expires_hours?: number | null
          checkout_theme?: string | null
          contact_email?: string | null
          created_at?: string
          custom_settings?: Json | null
          default_currency?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          omnibus_enabled?: boolean
          privacy_policy_url?: string | null
          shop_name?: string
          stripe_tax_rate_cache?: Json | null
          tax_id_collection_enabled?: boolean | null
          tax_mode?: string | null
          tax_rate?: number | null
          terms_of_service_url?: string | null
          updated_at?: string
        }
        Relationships: []
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
      user_product_access: {
        Row: {
          access_duration_days: number | null
          access_expires_at: string | null
          access_granted_at: string
          created_at: string
          expiry_notified_at: string | null
          id: string
          product_id: string
          user_id: string
          version: number
        }
        Insert: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string
          created_at?: string
          expiry_notified_at?: string | null
          id?: string
          product_id: string
          user_id: string
          version?: number
        }
        Update: {
          access_duration_days?: number | null
          access_expires_at?: string | null
          access_granted_at?: string
          created_at?: string
          expiry_notified_at?: string | null
          id?: string
          product_id?: string
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          description: string | null
          events: string[]
          id: string
          is_active: boolean | null
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          secret?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          event_type: string
          http_status: number | null
          id: string
          payload: Json | null
          response_body: string | null
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type: string
          http_status?: number | null
          id?: string
          payload?: Json | null
          response_body?: string | null
          status: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          event_type?: string
          http_status?: number | null
          id?: string
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
            referencedRelation: "user_access_stats"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
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
          duration_minutes_param?: number
          is_active_param?: boolean
          oto_product_id_param: string
          source_product_id_param: string
        }
        Returns: Json
      }
      batch_check_user_product_access: {
        Args: { product_slugs_param: string[] }
        Returns: Json
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
      claim_guest_purchases_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      cleanup_expired_oto_coupons: { Args: never; Returns: number }
      cleanup_old_guest_purchases: {
        Args: { retention_days?: number }
        Returns: number
      }
      create_refund_request: {
        Args: { reason_param?: string; transaction_id_param: string }
        Returns: Json
      }
      find_auto_apply_coupon: {
        Args: { customer_email_param: string; product_id_param: string }
        Returns: Json
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
      get_dashboard_stats: { Args: never; Returns: Json }
      get_detailed_revenue_stats: {
        Args: { p_goal_start_date?: string; p_product_id?: string }
        Returns: Json
      }
      get_hourly_revenue_stats: {
        Args: { p_product_id?: string; p_target_date?: string }
        Returns: {
          amount_by_currency: Json
          hour: number
          orders: number
        }[]
      }
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
          urgency_duration_minutes: number
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
          slug: string
          variant_name: string
        }[]
      }
      grant_free_product_access: {
        Args: {
          access_duration_days_param?: number
          product_slug_param: string
        }
        Returns: boolean
      }
      grant_product_access_service_role: {
        Args: {
          max_retries?: number
          product_id_param: string
          user_id_param: string
        }
        Returns: Json
      }
      grant_pwyw_free_access: {
        Args: {
          access_duration_days_param?: number
          product_slug_param: string
        }
        Returns: boolean
      }
      increment_coupon_usage: {
        Args: { coupon_id_param: string }
        Returns: undefined
      }
      increment_sale_quantity_sold: {
        Args: { p_product_id: string }
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
      mark_expired_pending_payments: { Args: never; Returns: number }
      migrate_guest_payment_data_to_profile: {
        Args: { p_user_id: string }
        Returns: Json
      }
      process_refund_request: {
        Args: {
          action_param: string
          admin_response_param?: string
          request_id_param: string
        }
        Returns: Json
      }
      process_stripe_payment_completion: {
        Args: {
          amount_total: number
          currency_param: string
          customer_email_param: string
          product_id_param: string
          session_id_param: string
          stripe_payment_intent_id?: string
          user_id_param?: string
        }
        Returns: Json
      }
      process_stripe_payment_completion_with_bump: {
        Args: {
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
      set_revenue_goal: {
        Args: {
          p_goal_amount: number
          p_product_id?: string
          p_start_date: string
        }
        Returns: undefined
      }
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
      validate_payment_transaction: {
        Args: { transaction_id: string }
        Returns: boolean
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cloneparms: [
        "DATA",
        "NODATA",
        "DDLONLY",
        "NOOWNER",
        "NOACL",
        "VERBOSE",
        "DEBUG",
        "FILECOPY",
        "DEBUGEXEC",
      ],
      tabledefs: [
        "PKEY_INTERNAL",
        "PKEY_EXTERNAL",
        "FKEYS_INTERNAL",
        "FKEYS_EXTERNAL",
        "COMMENTS",
        "FKEYS_NONE",
        "INCLUDE_TRIGGERS",
        "NO_TRIGGERS",
        "SHOWPARTS",
        "ACL_OWNER",
        "ACL_DCL",
        "ACL_POLICIES",
      ],
    },
  },
  seller_main: {
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

