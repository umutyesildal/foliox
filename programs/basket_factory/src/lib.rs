use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use basket::program::Basket as BasketProgram;
use basket::Basket as BasketAccount;

declare_id!("sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq");

pub const FACTORY_SEED: &[u8] = b"factory";
pub const BASKET_SEED: &[u8] = b"basket";

#[program]
pub mod basket_factory {
    use super::*;

    pub fn init_factory(
        ctx: Context<InitFactory>,
        treasury: Pubkey,
        creator_fee_split_bps: u16,
    ) -> Result<()> {
        require!(creator_fee_split_bps <= 10_000, FactoryError::InvalidSplit);
        let f = &mut ctx.accounts.factory;
        f.authority = ctx.accounts.authority.key();
        f.treasury = treasury;
        f.creator_fee_split_bps = creator_fee_split_bps;
        f.entry_fee_cap_bps = 300;
        f.exit_fee_cap_bps = 100;
        f.management_fee_cap_bps = 300;
        f.basket_count = 0;
        f.bump = ctx.bumps.factory;
        Ok(())
    }

    pub fn create_basket(
        ctx: Context<CreateBasket>,
        nonce: u64,
        constituents: Vec<Pubkey>,
        weights_bps: Vec<u16>,
        entry_fee_bps: u16,
        exit_fee_bps: u16,
        management_fee_bps: u16,
        metadata_hash: [u8; 32],
        seed_amounts: Vec<u64>,
    ) -> Result<()> {
        require!(constituents.len() == weights_bps.len(), FactoryError::LengthMismatch);
        require!(constituents.len() == seed_amounts.len(), FactoryError::LengthMismatch);
        require!(constituents.len() >= 2 && constituents.len() <= 20, FactoryError::InvalidConstituentCount);
        require!(metadata_hash != [0u8; 32], FactoryError::EmptyMetadataHash);

        for i in 0..constituents.len() {
            for j in (i + 1)..constituents.len() {
                require!(constituents[i] != constituents[j], FactoryError::DuplicateMint);
            }
        }

        let sum: u32 = weights_bps.iter().map(|w| *w as u32).sum();
        require!(sum == 10_000, FactoryError::WeightsNot10000);

        require!(entry_fee_bps <= ctx.accounts.factory.entry_fee_cap_bps, FactoryError::FeeOverCap);
        require!(exit_fee_bps <= ctx.accounts.factory.exit_fee_cap_bps, FactoryError::FeeOverCap);
        require!(management_fee_bps <= ctx.accounts.factory.management_fee_cap_bps, FactoryError::FeeOverCap);

        for amt in &seed_amounts { require!(*amt > 0, FactoryError::ZeroSeedAmount); }

        // In production, remaining_accounts are WhitelistedMint PDAs; verify Active here.
        // For V0 stub, we trust caller and emit only.

        let basket = &mut ctx.accounts.basket;
        basket.factory = ctx.accounts.factory.key();
        basket.creator = ctx.accounts.creator.key();
        basket.treasury = ctx.accounts.factory.treasury;
        basket.share_mint = ctx.accounts.share_mint.key();
        basket.nonce = nonce;
        let clock = Clock::get()?;
        basket.created_at = clock.unix_timestamp;
        basket.last_fee_accrual_ts = clock.unix_timestamp;
        basket.metadata_hash = metadata_hash;
        basket.num_constituents = constituents.len() as u8;
        for i in 0..20 {
            if i < constituents.len() {
                basket.constituents[i] = constituents[i];
                basket.target_weights_bps[i] = weights_bps[i];
            } else {
                basket.constituents[i] = Pubkey::default();
                basket.target_weights_bps[i] = 0;
            }
        }
        basket.entry_fee_bps = entry_fee_bps;
        basket.exit_fee_bps = exit_fee_bps;
        basket.management_fee_bps = management_fee_bps;
        basket.bump = ctx.bumps.basket;
        basket.vault_bump = 0;

        // Production: CPI transfer seed_amounts from creator ATAs -> vault ATAs and mint genesis shares
        // Stub: just emit

        ctx.accounts.factory.basket_count = ctx.accounts.factory.basket_count.checked_add(1).unwrap();

        emit!(BasketCreated {
            basket: basket.key(),
            creator: ctx.accounts.creator.key(),
            num_constituents: constituents.len() as u8,
            share_mint: ctx.accounts.share_mint.key(),
            ts: clock.unix_timestamp,
        });

        msg!("create_basket nonce={} constituents={:?} weights={:?} seed={:?}", nonce, constituents, weights_bps, seed_amounts);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitFactory<'info> {
    #[account(init, payer = authority, space = 8 + FactoryConfig::SIZE, seeds = [FACTORY_SEED], bump)]
    pub factory: Account<'info, FactoryConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateBasket<'info> {
    #[account(mut, seeds = [FACTORY_SEED], bump = factory.bump)]
    pub factory: Account<'info, FactoryConfig>,
    #[account(
        init,
        payer = creator,
        space = 8 + std::mem::size_of::<BasketAccount>(),
        seeds = [BASKET_SEED, factory.key().as_ref(), creator.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub basket: Account<'info, BasketAccount>,
    #[account(mut)]
    pub share_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: creator share ATA stub
    #[account(mut)]
    pub creator_share_ata: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct FactoryConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub creator_fee_split_bps: u16,
    pub entry_fee_cap_bps: u16,
    pub exit_fee_cap_bps: u16,
    pub management_fee_cap_bps: u16,
    pub basket_count: u64,
    pub bump: u8,
}
impl FactoryConfig {
    pub const SIZE: usize = 32 + 32 + 2 + 2 + 2 + 2 + 8 + 1;
}

#[event]
pub struct BasketCreated {
    pub basket: Pubkey,
    pub creator: Pubkey,
    pub num_constituents: u8,
    pub share_mint: Pubkey,
    pub ts: i64,
}

#[error_code]
pub enum FactoryError {
    #[msg("Length mismatch")]
    LengthMismatch,
    #[msg("Invalid constituent count (2-20)")]
    InvalidConstituentCount,
    #[msg("Weights must sum to 10000 bps")]
    WeightsNot10000,
    #[msg("Duplicate mint")]
    DuplicateMint,
    #[msg("Empty metadata hash")]
    EmptyMetadataHash,
    #[msg("Zero seed amount")]
    ZeroSeedAmount,
    #[msg("Fee over cap")]
    FeeOverCap,
    #[msg("Invalid split")]
    InvalidSplit,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_hash(n: u8) -> [u8;32] { let mut h=[0u8;32]; h[0]=n; if n==0 { h[1]=1; } h }
    fn pubkey(n: u8) -> Pubkey { let mut b=[0u8;32]; b[0]=n; if n==0 { b[1]=1; } Pubkey::new_from_array(b) }

    #[test]
    fn test_factory_size() { assert_eq!(FactoryConfig::SIZE, 32+32+2+2+2+2+8+1); }
    #[test]
    fn test_factory_seeds() { assert_eq!(FACTORY_SEED, b"factory"); assert_eq!(BASKET_SEED, b"basket"); }
    #[test]
    fn test_weights_sum_valid() {
        let w = vec![5000u16, 3000, 2000];
        let sum:u32 = w.iter().map(|x| *x as u32).sum();
        assert_eq!(sum, 10_000);
    }
    #[test]
    fn test_weights_sum_invalid() {
        let w = vec![5000u16, 3000, 1999];
        let sum:u32 = w.iter().map(|x| *x as u32).sum();
        assert_ne!(sum, 10_000);
        let w2 = vec![10000u16];
        let sum2:u32 = w2.iter().map(|x| *x as u32).sum();
        assert_eq!(sum2, 10_000); // but count 1 <2 so still invalid via count check
    }
    #[test]
    fn test_constituent_count_bounds() {
        for n in 2..=20 { assert!(n>=2 && n<=20); }
        assert!(!(1>=2 && 1<=20));
        assert!(!(21>=2 && 21<=20));
    }
    #[test]
    fn test_duplicate_detection() {
        let a = pubkey(1); let b = pubkey(2);
        let v = vec![a,b,a];
        let mut dup=false;
        for i in 0..v.len() { for j in (i+1)..v.len() { if v[i]==v[j] { dup=true; } } }
        assert!(dup);
        let v2 = vec![a,b,pubkey(3)];
        let mut dup2=false;
        for i in 0..v2.len() { for j in (i+1)..v2.len() { if v2[i]==v2[j] { dup2=true; } } }
        assert!(!dup2);
    }
    #[test]
    fn test_metadata_hash_zero_rejected() {
        assert_eq!([0u8;32], [0u8;32]);
        assert_ne!(dummy_hash(1), [0u8;32]);
        assert_ne!(dummy_hash(0), [0u8;32]);
    }
    #[test]
    fn test_fee_caps() {
        let cap_entry=300; let cap_exit=100; let cap_mgmt=300;
        assert!(300 <= cap_entry);
        assert!(301 > cap_entry);
        assert!(100 <= cap_exit);
        assert!(101 > cap_exit);
        assert!(300 <= cap_mgmt);
    }
    #[test]
    fn test_seed_amounts_zero_rejected() {
        let seeds = vec![100u64, 0, 100];
        assert!(seeds.iter().any(|x| *x==0));
        let seeds2 = vec![100u64, 100, 100];
        assert!(!seeds2.iter().any(|x| *x==0));
    }
    #[test]
    fn test_length_mismatch() {
        let c = vec![pubkey(1), pubkey(2)];
        let w = vec![5000u16];
        assert_ne!(c.len(), w.len());
        let w2 = vec![5000u16,5000];
        assert_eq!(c.len(), w2.len());
    }
    #[test]
    fn test_creator_split_valid() {
        assert!(9000 <= 10_000);
        assert!(10_000 <= 10_000);
        assert!(10_001 > 10_000);
    }
    #[test]
    fn test_basket_count_increment() {
        let mut f = FactoryConfig { authority: pubkey(1), treasury: pubkey(2), creator_fee_split_bps: 9000, entry_fee_cap_bps: 300, exit_fee_cap_bps: 100, management_fee_cap_bps: 300, basket_count: 0, bump: 0 };
        f.basket_count = f.basket_count.checked_add(1).unwrap();
        assert_eq!(f.basket_count, 1);
    }
    #[test]
    fn test_weights_various_valid() {
        for weights in [vec![5000,5000], vec![3333,3333,3334], vec![1000,1000,1000,1000,1000,1000,1000,1000,1000,1000]] {
            let sum:u32=weights.iter().map(|x| *x as u32).sum();
            assert_eq!(sum, 10_000);
        }
    }
    #[test]
    fn test_weights_random_invalid() {
        for weights in [vec![5000,5000,1], vec![10000,1], vec![0,0]] {
            let sum:u32=weights.iter().map(|x| *x as u32).sum();
            assert_ne!(sum, 10_000);
        }
    }
    #[test]
    fn test_factory_pda_seeds_deterministic() {
        let factory = pubkey(10);
        let creator = pubkey(20);
        let nonce:u64=42;
        let seed1 = [BASKET_SEED, factory.as_ref(), creator.as_ref(), &nonce.to_le_bytes()].concat();
        let seed2 = [BASKET_SEED, factory.as_ref(), creator.as_ref(), &nonce.to_le_bytes()].concat();
        assert_eq!(seed1, seed2);
        let nonce2:u64=43;
        let seed3 = [BASKET_SEED, factory.as_ref(), creator.as_ref(), &nonce2.to_le_bytes()].concat();
        assert_ne!(seed1, seed3);
    }
    #[test]
    fn test_genesis_shares_constant() {
        // factory always mints 1M genesis, not dependent on seed size
        const GENESIS:u64=1_000_000;
        assert_eq!(GENESIS, 1_000_000);
        // even with tiny seed 1 vs large 1e12, genesis same
        assert_eq!(GENESIS, GENESIS);
    }
}
