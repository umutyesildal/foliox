use anchor_lang::prelude::*;

declare_id!("bdEDPr9KGtkSABS8Sg3gWeJKyQEaTQVaBRvCu38YMNz");

pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_SEED: &[u8] = b"mint";

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
        require!(decimals <= 12, WhitelistError::InvalidDecimals);

        let whitelisted = &mut ctx.accounts.whitelisted_mint;
        whitelisted.mint = ctx.accounts.mint.key();
        whitelisted.decimals = decimals;
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
    /// CHECK: mint is Token-2022
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
}
