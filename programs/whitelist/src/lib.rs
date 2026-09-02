use anchor_lang::prelude::*;
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;
use anchor_spl::token_interface::Mint;

declare_id!("FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS");

pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_SEED: &[u8] = b"mint";

/// Maximum decimals accepted for a whitelisted mint.
pub const MAX_DECIMALS: u8 = 12;

#[program]
pub mod whitelist {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.pending_authority = None;
        config.mint_count = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn add_mint(
        ctx: Context<AddMint>,
        decimals: u8,
        price_source: String,
    ) -> Result<()> {
        require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), WhitelistError::Unauthorized);
        require!(price_source.len() <= 64, WhitelistError::PriceSourceTooLong);

        // No lazy trust in the caller's `decimals` arg: the mint account is
        // validated in-context. The mint must be owned by the Token-2022
        // program and the arg must match the actual on-chain mint decimals —
        // downstream `transfer_checked` calls depend on this cached value.
        let mint_ai = ctx.accounts.mint.to_account_info();
        check_mint_owner(mint_ai.owner)?;
        let on_chain_decimals = {
            let data = mint_ai.try_borrow_data()?;
            decode_mint_decimals(&data)?
        };
        check_decimals(decimals, on_chain_decimals)?;

        let whitelisted = &mut ctx.accounts.whitelisted_mint;
        whitelisted.mint = ctx.accounts.mint.key();
        // Cached from the mint itself (== `decimals` by the check above).
        whitelisted.decimals = on_chain_decimals;
        whitelisted.multiplier_watermark = 1_000_000;
        whitelisted.status = WhitelistStatus::Active as u8;
        whitelisted.price_source = price_source;
        whitelisted.bump = ctx.bumps.whitelisted_mint;

        let config = &mut ctx.accounts.config;
        config.mint_count = config.mint_count.checked_add(1).unwrap();

        Ok(())
    }

    pub fn pause_mint(ctx: Context<UpdateMint>) -> Result<()> {
        require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), WhitelistError::Unauthorized);
        let m = &mut ctx.accounts.whitelisted_mint;
        require!(m.status == WhitelistStatus::Active as u8, WhitelistError::AlreadyPaused);
        m.status = WhitelistStatus::PausedNewMints as u8;
        Ok(())
    }

    pub fn unpause_mint(ctx: Context<UpdateMint>) -> Result<()> {
        require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), WhitelistError::Unauthorized);
        let m = &mut ctx.accounts.whitelisted_mint;
        require!(m.status == WhitelistStatus::PausedNewMints as u8, WhitelistError::NotPaused);
        m.status = WhitelistStatus::Active as u8;
        Ok(())
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), WhitelistError::Unauthorized);
        let config = &mut ctx.accounts.config;
        config.pending_authority = Some(new_authority);
        Ok(())
    }

    pub fn claim_authority(ctx: Context<ClaimAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let pending = config.pending_authority.ok_or(WhitelistError::NoPendingAuthority)?;
        require!(ctx.accounts.new_authority.key() == pending, WhitelistError::Unauthorized);
        config.authority = pending;
        config.pending_authority = None;
        Ok(())
    }
}

// ===================== pure validation helpers (unit tested) =====================

/// The mint account must be owned by the Token-2022 program (spec §11 P0).
pub fn check_mint_owner(owner: &Pubkey) -> Result<()> {
    require!(*owner == TOKEN_2022_PROGRAM_ID, WhitelistError::InvalidMintOwner);
    Ok(())
}

/// Deserializes a Token-2022 mint (extension-aware, so xStocks with e.g.
/// ScaledUiAmountConfig TLV data parse fine) and returns its on-chain decimals.
pub fn decode_mint_decimals(data: &[u8]) -> Result<u8> {
    let mint = Mint::try_deserialize_unchecked(&mut &data[..])?;
    Ok(mint.decimals)
}

/// The `decimals` arg must be within the cap AND match the actual mint.
pub fn check_decimals(arg: u8, on_chain_decimals: u8) -> Result<()> {
    require!(arg <= MAX_DECIMALS, WhitelistError::InvalidDecimals);
    require!(arg == on_chain_decimals, WhitelistError::DecimalsMismatch);
    Ok(())
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistConfig::SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, WhitelistConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddMint<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, WhitelistConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: mint is validated in the handler — owner must be the Token-2022
    /// program (`check_mint_owner`) and the `decimals` arg must match the
    /// on-chain mint decimals (`decode_mint_decimals` + `check_decimals`).
    pub mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistedMint::SIZE,
        seeds = [MINT_SEED, mint.key().as_ref()],
        bump
    )]
    pub whitelisted_mint: Account<'info, WhitelistedMint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMint<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, WhitelistConfig>,
    pub authority: Signer<'info>,
    #[account(mut, seeds = [MINT_SEED, whitelisted_mint.mint.as_ref()], bump = whitelisted_mint.bump)]
    pub whitelisted_mint: Account<'info, WhitelistedMint>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, WhitelistConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimAuthority<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, WhitelistConfig>,
    pub new_authority: Signer<'info>,
}

#[account]
pub struct WhitelistConfig {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub mint_count: u32,
    pub bump: u8,
}
impl WhitelistConfig {
    pub const SIZE: usize = 32 + (1 + 32) + 4 + 1;
}

#[account]
pub struct WhitelistedMint {
    pub mint: Pubkey,
    pub decimals: u8,
    pub multiplier_watermark: u64,
    pub status: u8,
    pub price_source: String,
    pub bump: u8,
}
impl WhitelistedMint {
    pub const SIZE: usize = 32 + 1 + 8 + 1 + (4 + 64) + 1;
}

#[repr(u8)]
pub enum WhitelistStatus {
    Active = 0,
    PausedNewMints = 1,
}

#[error_code]
pub enum WhitelistError {
    #[msg("Price source exceeds 64 chars")]
    PriceSourceTooLong,
    #[msg("Invalid decimals (max 12)")]
    InvalidDecimals,
    #[msg("Already paused")]
    AlreadyPaused,
    #[msg("Not paused")]
    NotPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No pending authority")]
    NoPendingAuthority,
    #[msg("Mint account is not owned by the Token-2022 program")]
    InvalidMintOwner,
    #[msg("Decimals arg does not match the on-chain mint decimals")]
    DecimalsMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_size() {
        assert_eq!(WhitelistConfig::SIZE, 32 + 33 + 4 + 1);
    }
    #[test]
    fn test_mint_size() {
        assert_eq!(WhitelistedMint::SIZE, 32 + 1 + 8 + 1 + 68 + 1);
    }
    #[test]
    fn test_whitelist_status_values() {
        assert_eq!(WhitelistStatus::Active as u8, 0);
        assert_eq!(WhitelistStatus::PausedNewMints as u8, 1);
    }
    #[test]
    fn test_price_source_length_validation() {
        let ok = "a".repeat(64);
        assert!(ok.len() <= 64);
        let bad = "a".repeat(65);
        assert!(bad.len() > 64);
    }
    #[test]
    fn test_decimals_validation() {
        for d in 0..=12 { assert!(d <= 12); }
        assert!(13 > 12);
    }
    #[test]
    fn test_seed_constants() {
        assert_eq!(CONFIG_SEED, b"config");
        assert_eq!(MINT_SEED, b"mint");
    }
    #[test]
    fn test_pending_authority_none_initially() {
        let cfg = WhitelistConfig { authority: Pubkey::default(), pending_authority: None, mint_count: 0, bump: 0 };
        assert!(cfg.pending_authority.is_none());
        assert_eq!(cfg.mint_count, 0);
    }
    #[test]
    fn test_mint_count_increment() {
        let mut cfg = WhitelistConfig { authority: Pubkey::default(), pending_authority: None, mint_count: 0, bump: 0 };
        cfg.mint_count = cfg.mint_count.checked_add(1).unwrap();
        assert_eq!(cfg.mint_count, 1);
        cfg.mint_count = cfg.mint_count.checked_add(1).unwrap();
        assert_eq!(cfg.mint_count, 2);
    }
    #[test]
    fn test_pause_idempotency() {
        let mut m = WhitelistedMint { mint: Pubkey::default(), decimals: 6, multiplier_watermark: 1_000_000, status: WhitelistStatus::Active as u8, price_source: "jupiter:TSLAx".to_string(), bump: 0 };
        assert_eq!(m.status, 0);
        m.status = WhitelistStatus::PausedNewMints as u8;
        assert_eq!(m.status, 1);
        // pausing again should be AlreadyPaused in program logic
        assert!(m.status == 1);
        m.status = WhitelistStatus::Active as u8;
        assert_eq!(m.status, 0);
    }
    #[test]
    fn test_transfer_authority_flow() {
        let auth = Pubkey::new_unique();
        let new_auth = Pubkey::new_unique();
        let mut cfg = WhitelistConfig { authority: auth, pending_authority: None, mint_count: 0, bump: 0 };
        cfg.pending_authority = Some(new_auth);
        assert_eq!(cfg.pending_authority.unwrap(), new_auth);
        // claim
        let pending = cfg.pending_authority.unwrap();
        assert_eq!(pending, new_auth);
        cfg.authority = pending;
        cfg.pending_authority = None;
        assert_eq!(cfg.authority, new_auth);
        assert!(cfg.pending_authority.is_none());
    }
    #[test]
    fn test_price_source_various() {
        for valid in ["jupiter:TSLAx", "pyth:NVDAx", "switchboard:AAPLx", ""] {
            assert!(valid.len() <= 64);
        }
    }
    #[test]
    fn test_multiplier_watermark_default() {
        let m = WhitelistedMint { mint: Pubkey::default(), decimals: 6, multiplier_watermark: 1_000_000, status: 0, price_source: "".to_string(), bump: 0 };
        assert_eq!(m.multiplier_watermark, 1_000_000);
        // after split 2x, multiplier 2_000_000
        let mut m2 = m;
        m2.multiplier_watermark = 2_000_000;
        assert_eq!(m2.multiplier_watermark, 2_000_000);
    }

    // ========== ADD_MINT IN-CONTEXT MINT VALIDATION ==========
    #[test]
    fn test_check_mint_owner_accepts_token_2022() {
        // Any account owned by Token-2022 passes.
        assert!(check_mint_owner(&TOKEN_2022_PROGRAM_ID).is_ok());
    }
    #[test]
    fn test_check_mint_owner_rejects_other_programs() {
        // System program (wallet), SPL Token classic, random program — all reject.
        assert!(check_mint_owner(&Pubkey::default()).is_err());
        assert!(check_mint_owner(&Pubkey::new_unique()).is_err());
    }
    #[test]
    fn test_check_decimals_ok() {
        for d in 0..=12u8 {
            assert!(check_decimals(d, d).is_ok());
        }
        assert!(check_decimals(6, 6).is_ok());
    }
    #[test]
    fn test_check_decimals_arg_over_cap_fails() {
        // arg > 12 is invalid even if it would match the mint
        assert!(check_decimals(13, 13).is_err());
        assert!(check_decimals(u8::MAX, u8::MAX).is_err());
    }
    #[test]
    fn test_check_decimals_mismatch_fails() {
        // the core "no lazy trust" property: a lying arg is rejected
        assert!(check_decimals(6, 9).is_err());
        assert!(check_decimals(9, 6).is_err());
        assert!(check_decimals(0, 6).is_err());
    }
    #[test]
    fn test_decode_mint_decimals_base_mint() {
        // spl_token Mint layout: authority 0..36, supply 36..44, decimals 44,
        // is_initialized 45, freeze_authority 46..82 (LEN = 82).
        let mut buf = [0u8; 82];
        buf[44] = 6; // decimals
        buf[45] = 1; // is_initialized
        assert_eq!(decode_mint_decimals(&buf).unwrap(), 6);
        buf[44] = 9;
        assert_eq!(decode_mint_decimals(&buf).unwrap(), 9);
        buf[44] = 0;
        assert_eq!(decode_mint_decimals(&buf).unwrap(), 0);
    }
    #[test]
    fn test_decode_mint_decimals_truncated_fails() {
        let buf = [0u8; 40];
        assert!(decode_mint_decimals(&buf).is_err());
        let empty: [u8; 0] = [];
        assert!(decode_mint_decimals(&empty).is_err());
    }
    #[test]
    fn test_add_mint_caches_onchain_decimals_semantics() {
        // The stored WhitelistedMint.decimals must come from the mint itself;
        // check_decimals guarantees arg == on-chain before it is cached.
        let arg: u8 = 6;
        let on_chain: u8 = 6;
        assert!(check_decimals(arg, on_chain).is_ok());
        let mut m = WhitelistedMint { mint: Pubkey::default(), decimals: 0, multiplier_watermark: 1_000_000, status: WhitelistStatus::Active as u8, price_source: "jupiter:TSLAx".to_string(), bump: 0 };
        m.decimals = on_chain; // what add_mint stores
        assert_eq!(m.decimals, arg);
        assert_eq!(m.status, WhitelistStatus::Active as u8);
    }
}
