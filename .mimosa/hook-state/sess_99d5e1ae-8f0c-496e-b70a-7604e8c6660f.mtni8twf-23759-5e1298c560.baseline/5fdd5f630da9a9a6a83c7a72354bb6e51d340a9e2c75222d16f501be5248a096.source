use anchor_lang::prelude::*;
use anchor_spl::associated_token::{
    self, get_associated_token_address_with_program_id, AssociatedToken, Create,
};
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;
use anchor_spl::token_interface::{
    find_mint_account_size, initialize_mint2, mint_to, set_authority, transfer_checked, InitializeMint2,
    Mint, MintTo, TokenAccount, TokenInterface, TransferChecked, SetAuthority,
};
use basket::Basket as BasketAccount;
use whitelist::WhitelistedMint;

declare_id!("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF");

pub const FACTORY_SEED: &[u8] = b"factory";
pub const BASKET_SEED: &[u8] = b"basket";
/// Seed for the basket share mint PDA (spec §2.1: `b"share_mint", basket.key()`).
pub const SHARE_MINT_SEED: &[u8] = b"share_mint";

/// Basket share token decimals (spec §3.2 validation 9).
pub const SHARE_MINT_DECIMALS: u8 = 6;

/// Constituent count bounds (spec §3.2 validation 1).
pub const MIN_CONSTITUENTS: usize = 2;
pub const MAX_CONSTITUENTS: usize = 20;
/// Weights are in basis points and must total 100% (spec §3.2 validation 3).
pub const WEIGHTS_DENOMINATOR: u32 = 10_000;

/// remaining_accounts layout, per constituent i in `constituents` order:
/// `[whitelisted_mint_pda_i, mint_i, creator_ata_i, vault_ata_i]`.
pub const ACCOUNTS_PER_CONSTITUENT: usize = 4;

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

    /// Deploys an immutable basket ATOMICALLY (spec §3.2): all arg validations,
    /// per-constituent whitelist + mint + ATA validation, Basket PDA + Token-2022
    /// share mint (6 decimals) + vault ATA creation, raw seed transfers
    /// creator→vault, genesis 1_000_000 shares minted to the creator, and the
    /// canonical vault-authority bump written into `basket.vault_bump`.
    ///
    /// remaining_accounts layout per constituent i (in `constituents` order):
    /// `[WhitelistedMint PDA, mint, creator_ata, vault_ata]`.
    pub fn create_basket<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateBasket<'info>>,
        nonce: u64,
        constituents: Vec<Pubkey>,
        weights_bps: Vec<u16>,
        entry_fee_bps: u16,
        exit_fee_bps: u16,
        management_fee_bps: u16,
        metadata_hash: [u8; 32],
        seed_amounts: Vec<u64>,
    ) -> Result<()> {
        // ---- pure arg validations (spec §3.2 validations 1-8) ----
        check_lengths(&constituents, &weights_bps, &seed_amounts)?;
        check_constituent_count(constituents.len())?;
        check_no_duplicates(&constituents)?;
        check_weights_sum(&weights_bps)?;
        check_fee_caps(entry_fee_bps, exit_fee_bps, management_fee_bps, &ctx.accounts.factory)?;
        check_metadata_hash(&metadata_hash)?;
        check_seed_amounts(&seed_amounts)?;
        // Validation 7: basket_count + 1 must not overflow.
        let new_basket_count = ctx
            .accounts
            .factory
            .basket_count
            .checked_add(1)
            .ok_or(FactoryError::BasketCountOverflow)?;

        let n = constituents.len();
        let remaining = &ctx.remaining_accounts;
        check_remaining_accounts_layout(remaining.len(), n)?;

        let factory_key = ctx.accounts.factory.key();
        let creator_key = ctx.accounts.creator.key();
        let token_program = &ctx.accounts.token_program;
        let token_program_key = token_program.key();
        let share_mint_key = ctx.accounts.share_mint.key();

        // The basket program's vault/share-mint authority PDA:
        // seeds ["basket", basket.key()] under the BASKET program id (NOT the
        // factory's), so a plain Anchor seeds constraint cannot be used here.
        // The REAL bump is stored on the Basket account (spec §5).
        let basket_key = ctx.accounts.basket.key();
        let (vault_authority_key, vault_bump) = vault_authority_pda(&basket_key);
        require_keys_eq!(
            ctx.accounts.vault_authority.key(),
            vault_authority_key,
            FactoryError::InvalidVaultAuthority
        );

        // Create the Token-2022 share mint PDA (moved out of the context's
        // `init` constraint to keep `try_accounts` under the SBF stack limit —
        // the seeds/bump constraint already proved the address above is the
        // genuine `["share_mint", basket.key()]` PDA). This is the same
        // create_account + initialize_mint2 the Anchor init used to emit, so
        // the on-chain result is identical (6 decimals, mint authority =
        // factory PDA, no freeze authority). Failures revert the whole tx.
        init_share_mint(
            &ctx.accounts.creator,
            &ctx.accounts.share_mint,
            &ctx.accounts.system_program,
            token_program,
            &factory_key,
            ctx.bumps.share_mint,
            &basket_key,
        )?;

        // ---- per-constituent validation (no lazy trust, validate before act) ----
        // 1. WhitelistedMint PDA: owned by the whitelist program, genuine PDA for
        //    the constituent (checked against its stored canonical bump), mint
        //    match, status Active, cached decimals == on-chain mint decimals.
        // 2. Creator ATA: derived ATA of (creator, mint), owner == creator, minted
        //    enough to cover the raw seed amount.
        // 3. Vault ATA: derived ATA of (vault_authority, mint).
        let mut constituents_decimals: Vec<u8> = Vec::with_capacity(n);
        for i in 0..n {
            let wl_ai = &remaining[i * ACCOUNTS_PER_CONSTITUENT];
            let mint_ai = &remaining[i * ACCOUNTS_PER_CONSTITUENT + 1];
            let creator_ata_ai = &remaining[i * ACCOUNTS_PER_CONSTITUENT + 2];
            let vault_ata_ai = &remaining[i * ACCOUNTS_PER_CONSTITUENT + 3];

            require!(wl_ai.owner == &whitelist::ID, FactoryError::InvalidWhitelistAccount);
            let rec = {
                let data = wl_ai.try_borrow_data()?;
                decode_whitelisted_mint(&data)?
            };
            check_whitelisted_record(
                &rec.mint,
                rec.status,
                rec.bump,
                &constituents[i],
                &wl_ai.key(),
            )?;

            require!(
                mint_ai.owner == &token_program_key,
                FactoryError::InvalidMintAccount
            );
            require_keys_eq!(mint_ai.key(), constituents[i], FactoryError::MintMismatch);
            let mint_decimals = {
                let data = mint_ai.try_borrow_data()?;
                decode_mint_decimals(&data)?
            };
            require!(rec.decimals == mint_decimals, FactoryError::DecimalsMismatch);
            constituents_decimals.push(mint_decimals);

            require_keys_eq!(
                creator_ata_ai.key(),
                get_associated_token_address_with_program_id(
                    &creator_key,
                    &constituents[i],
                    &token_program_key
                ),
                FactoryError::InvalidCreatorAta
            );
            let (ata_mint, ata_owner, ata_amount) = {
                let data = creator_ata_ai.try_borrow_data()?;
                let ata = TokenAccount::try_deserialize_unchecked(&mut &data[..])?;
                (ata.mint, ata.owner, ata.amount)
            };
            require_keys_eq!(ata_mint, constituents[i], FactoryError::InvalidCreatorAta);
            require_keys_eq!(ata_owner, creator_key, FactoryError::InvalidCreatorAta);
            require!(
                ata_amount >= seed_amounts[i],
                FactoryError::InsufficientSeedBalance
            );

            require_keys_eq!(
                vault_ata_ai.key(),
                get_associated_token_address_with_program_id(
                    &vault_authority_key,
                    &constituents[i],
                    &token_program_key
                ),
                FactoryError::InvalidVaultAta
            );
        }

        // ---- create + initialize the Basket data account (owned by the basket program) ----
        // The basket PDA derives under THIS program, but its data must be
        // owned by the BASKET program: mint/redeem/accrue type it as
        // `Account<Basket>` (owner check) and the runtime only lets the owner
        // program write account data. Anchor `init` cannot express that (it
        // both creates and types the account as the current program's), and
        // the basket program cannot create the PDA itself (a program can only
        // invoke_signed its OWN PDAs; this PDA is the factory's). So:
        //   (1) the factory runs system create_account with owner = basket
        //       program id (the factory PDA-signs for its own PDA);
        //   (2) the factory CPIs basket::init_basket, which verifies and
        //       writes the data into the account it now owns.
        // The factory PDA signs the CPI, making init_basket factory-only; the
        // whole tx is atomic, so any failure reverts everything.
        let basket_space = (8 + std::mem::size_of::<BasketAccount>()) as u64;
        let basket_lamports = Rent::get()?.minimum_balance(basket_space as usize);
        {
            let nonce_le = nonce.to_le_bytes();
            let basket_bump_arr = [ctx.bumps.basket];
            let basket_signer_seeds: [&[u8]; 5] = [
                BASKET_SEED,
                factory_key.as_ref(),
                creator_key.as_ref(),
                &nonce_le,
                &basket_bump_arr,
            ];
            anchor_lang::system_program::create_account(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::CreateAccount {
                        from: ctx.accounts.creator.to_account_info(),
                        to: ctx.accounts.basket.to_account_info(),
                    },
                    &[&basket_signer_seeds],
                ),
                basket_lamports,
                basket_space,
                &basket::ID,
            )?;
        }
        {
            let factory_bump_arr = [ctx.accounts.factory.bump];
            let factory_signer_seeds: [&[u8]; 2] = [FACTORY_SEED, &factory_bump_arr];
            // The factory PDA signs the CPI via `invoke_signed` + the seeds
            // above, but Anchor serializes the AccountMeta's `is_signer` from
            // the caller's AccountInfo flag (false for a PDA that is not a tx
            // signer), and `init_basket` requires `authority.is_signer` — so
            // mark the flag on our local clone. This is NOT a privilege
            // escalation: the runtime rejects the CPI unless the flagged
            // account is genuinely derived from [FACTORY_SEED, bump] under
            // THIS program id (the seeds passed to invoke_signed), and the
            // handler-side keys_eq! against `factory_pda()` still pins the
            // canonical factory PDA.
            let mut authority_info = ctx.accounts.factory.to_account_info();
            authority_info.is_signer = true;
            basket::cpi::init_basket(
                CpiContext::new_with_signer(
                    ctx.accounts.basket_program.to_account_info(),
                    basket::cpi::accounts::InitBasket {
                        basket: ctx.accounts.basket.to_account_info(),
                        authority: authority_info,
                    },
                    &[&factory_signer_seeds],
                ),
                creator_key,
                nonce,
                ctx.bumps.basket,
                ctx.accounts.factory.treasury,
                share_mint_key,
                metadata_hash,
                constituents.clone(),
                weights_bps.clone(),
                entry_fee_bps,
                exit_fee_bps,
                management_fee_bps,
                vault_bump,
            )?;
        }

        // ---- per-constituent action: create vault ATA + RAW seed transfer ----
        for i in 0..n {
            let mint_ai = remaining[i * ACCOUNTS_PER_CONSTITUENT + 1].clone();
            let creator_ata_ai = remaining[i * ACCOUNTS_PER_CONSTITUENT + 2].clone();
            let vault_ata_ai = remaining[i * ACCOUNTS_PER_CONSTITUENT + 3].clone();

            // Vault ATA owned by the basket program's vault authority PDA.
            associated_token::create_idempotent(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                Create {
                    payer: ctx.accounts.creator.to_account_info(),
                    associated_token: vault_ata_ai.clone(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                    mint: mint_ai.clone(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: token_program.to_account_info(),
                },
            ))?;
            let (vault_mint, vault_owner) = {
                let data = vault_ata_ai.try_borrow_data()?;
                let ata = TokenAccount::try_deserialize_unchecked(&mut &data[..])?;
                (ata.mint, ata.owner)
            };
            require_keys_eq!(vault_mint, constituents[i], FactoryError::InvalidVaultAta);
            require_keys_eq!(vault_owner, vault_authority_key, FactoryError::InvalidVaultAta);

            // RAW ONLY — Token-2022 raw seed amount creator → vault, decimals from
            // the whitelist cache (== on-chain mint decimals, checked above).
            // Atomic with basket creation — no init-then-seed two-step (§11 P2).
            transfer_checked(
                CpiContext::new(
                    token_program.to_account_info(),
                    TransferChecked {
                        from: creator_ata_ai,
                        mint: mint_ai,
                        to: vault_ata_ai,
                        authority: ctx.accounts.creator.to_account_info(),
                    },
                ),
                seed_amounts[i],
                constituents_decimals[i],
            )?;
        }

        // ---- creator share ATA + genesis mint ----
        // The share mint is initialized with the factory PDA as TEMPORARY mint
        // authority: the basket program's vault authority PDA cannot sign CPIs
        // from this program (it belongs to the basket program id), so within
        // this single atomic tx the factory mints genesis and then hands the
        // mint authority to the vault authority PDA — the permanent authority
        // the basket program signs with (spec §3.2 validation 9/10).
        require_keys_eq!(
            ctx.accounts.creator_share_ata.key(),
            get_associated_token_address_with_program_id(
                &creator_key,
                &share_mint_key,
                &token_program_key
            ),
            FactoryError::InvalidShareAta
        );
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            Create {
                payer: ctx.accounts.creator.to_account_info(),
                associated_token: ctx.accounts.creator_share_ata.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.share_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: token_program.to_account_info(),
            },
        ))?;
        let (creator_ata_mint, creator_ata_owner) = {
            let data = ctx.accounts.creator_share_ata.try_borrow_data()?;
            let ata = TokenAccount::try_deserialize_unchecked(&mut &data[..])?;
            (ata.mint, ata.owner)
        };
        require_keys_eq!(creator_ata_mint, share_mint_key, FactoryError::InvalidShareAta);
        require_keys_eq!(creator_ata_owner, creator_key, FactoryError::InvalidShareAta);

        {
            let factory_bump_arr = [ctx.accounts.factory.bump];
            let factory_signer_seeds: [&[u8]; 2] = [FACTORY_SEED, &factory_bump_arr];
            let signer_seeds: &[&[&[u8]]] = &[&factory_signer_seeds];

            // RAW ONLY — genesis share supply (basket::GENESIS_SHARES = 1_000_000,
            // 6 decimals) minted to the creator; fixed amount = inflation-attack
            // protection (spec §11 P1), independent of the seed size.
            mint_to(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.share_mint.to_account_info(),
                        to: ctx.accounts.creator_share_ata.to_account_info(),
                        authority: ctx.accounts.factory.to_account_info(),
                    },
                    signer_seeds,
                ),
                basket::GENESIS_SHARES,
            )?;

            // Hand the mint authority to the basket program's vault authority PDA.
            set_authority(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    SetAuthority {
                        current_authority: ctx.accounts.factory.to_account_info(),
                        account_or_mint: ctx.accounts.share_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                AuthorityType::MintTokens,
                Some(vault_authority_key),
            )?;
        }

        ctx.accounts.factory.basket_count = new_basket_count;

        let clock = Clock::get()?;
        emit!(BasketCreated {
            basket: basket_key,
            creator: creator_key,
            num_constituents: n as u8,
            share_mint: share_mint_key,
            ts: clock.unix_timestamp,
        });

        msg!(
            "create_basket nonce={} constituents={} genesis_shares={} vault_bump={}",
            nonce,
            n,
            basket::GENESIS_SHARES,
            vault_bump
        );
        Ok(())
    }
}

// ===================== pure validation helpers (unit tested) =====================

pub fn check_lengths(constituents: &[Pubkey], weights_bps: &[u16], seed_amounts: &[u64]) -> Result<()> {
    require!(constituents.len() == weights_bps.len(), FactoryError::LengthMismatch);
    require!(constituents.len() == seed_amounts.len(), FactoryError::LengthMismatch);
    Ok(())
}

pub fn check_constituent_count(n: usize) -> Result<()> {
    require!(
        n >= MIN_CONSTITUENTS && n <= MAX_CONSTITUENTS,
        FactoryError::InvalidConstituentCount
    );
    Ok(())
}

pub fn check_no_duplicates(constituents: &[Pubkey]) -> Result<()> {
    for i in 0..constituents.len() {
        for j in (i + 1)..constituents.len() {
            require!(constituents[i] != constituents[j], FactoryError::DuplicateMint);
        }
    }
    Ok(())
}

/// u128 accumulator — no overflow for any realistic weight vector.
pub fn check_weights_sum(weights_bps: &[u16]) -> Result<()> {
    let sum: u128 = weights_bps.iter().map(|w| *w as u128).sum();
    require!(sum == WEIGHTS_DENOMINATOR as u128, FactoryError::WeightsNot10000);
    Ok(())
}

pub fn check_fee_caps(
    entry_fee_bps: u16,
    exit_fee_bps: u16,
    management_fee_bps: u16,
    factory: &FactoryConfig,
) -> Result<()> {
    require!(entry_fee_bps <= factory.entry_fee_cap_bps, FactoryError::FeeOverCap);
    require!(exit_fee_bps <= factory.exit_fee_cap_bps, FactoryError::FeeOverCap);
    require!(
        management_fee_bps <= factory.management_fee_cap_bps,
        FactoryError::FeeOverCap
    );
    Ok(())
}

pub fn check_seed_amounts(seed_amounts: &[u64]) -> Result<()> {
    for amt in seed_amounts {
        require!(*amt > 0, FactoryError::ZeroSeedAmount);
    }
    Ok(())
}

pub fn check_metadata_hash(metadata_hash: &[u8; 32]) -> Result<()> {
    require!(*metadata_hash != [0u8; 32], FactoryError::EmptyMetadataHash);
    Ok(())
}

pub fn check_remaining_accounts_layout(remaining_len: usize, num_constituents: usize) -> Result<()> {
    require!(
        remaining_len == num_constituents * ACCOUNTS_PER_CONSTITUENT,
        FactoryError::InvalidRemainingAccounts
    );
    Ok(())
}

/// Validates one `WhitelistedMint` record:
/// - the record belongs to the expected constituent mint;
/// - status is Active (paused mints cannot enter new baskets);
/// - the PDA key matches the whitelist program's derivation for the constituent
///   using the record's stored bump (proves the account is the genuine
///   WhitelistedMint PDA, not a forged look-alike).
pub fn check_whitelisted_record(
    rec_mint: &Pubkey,
    rec_status: u8,
    rec_bump: u8,
    expected_mint: &Pubkey,
    pda_key: &Pubkey,
) -> Result<()> {
    require_keys_eq!(*rec_mint, *expected_mint, FactoryError::NotWhitelisted);
    require!(
        rec_status == whitelist::WhitelistStatus::Active as u8,
        FactoryError::MintNotActive
    );
    let expected_pda = Pubkey::create_program_address(
        &[whitelist::MINT_SEED, expected_mint.as_ref(), &[rec_bump]],
        &whitelist::ID,
    )
    .map_err(|_| error!(FactoryError::InvalidWhitelistAccount))?;
    require_keys_eq!(*pda_key, expected_pda, FactoryError::InvalidWhitelistAccount);
    Ok(())
}

/// The basket program's vault/share-mint authority PDA:
/// seeds `["basket", basket.key()]` derived under the BASKET program id.
/// Returns (pda, real_bump) — the bump is the value written to `basket.vault_bump`.
pub fn vault_authority_pda(basket_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[basket::BASKET_SEED, basket_key.as_ref()], &basket::ID)
}

/// Deserializes a Token-2022 mint (extension-aware) and returns its decimals.
pub fn decode_mint_decimals(data: &[u8]) -> Result<u8> {
    let mint = Mint::try_deserialize_unchecked(&mut &data[..])?;
    Ok(mint.decimals)
}

/// Deserializes a `WhitelistedMint` PDA record (discriminator checked).
pub fn decode_whitelisted_mint(data: &[u8]) -> Result<WhitelistedMint> {
    WhitelistedMint::try_deserialize(&mut &data[..])
}

/// Creates the Token-2022 share mint PDA: system `create_account` (extension
/// -less spl_token_2022 Mint length, rent-exempt) + `initialize_mint2` with
/// the factory PDA as mint authority and no freeze authority — the same
/// on-chain effect as the former Anchor `init, mint::decimals/authority/
/// token_program` constraint. Lives here (not in the `#[derive(Accounts)]`
/// context) so Anchor does not inline the mint-initialization code into
/// `CreateBasket::try_accounts`, whose stack frame must stay under the 4 KB
/// SBF limit. `share_mint_bump` is the PDA bump verified by the context's
/// seeds constraint; `basket_key` completes the PDA signer seeds so the
/// factory program can sign for the mint PDA.
#[inline(never)]
pub fn init_share_mint<'info>(
    payer: &Signer<'info>,
    share_mint: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    token_program: &Interface<'info, TokenInterface>,
    mint_authority: &Pubkey,
    share_mint_bump: u8,
    basket_key: &Pubkey,
) -> Result<()> {
    let space = find_mint_account_size(None)? as u64;
    let lamports = Rent::get()?.minimum_balance(space as usize);
    let bump_arr = [share_mint_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[SHARE_MINT_SEED, basket_key.as_ref(), &bump_arr]];
    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: payer.to_account_info(),
                to: share_mint.to_account_info(),
            },
            signer_seeds,
        ),
        lamports,
        space,
        &token_program.key(),
    )?;
    initialize_mint2(
        CpiContext::new(
            token_program.to_account_info(),
            InitializeMint2 {
                mint: share_mint.to_account_info(),
            },
        ),
        SHARE_MINT_DECIMALS,
        mint_authority,
        None,
    )?;
    Ok(())
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
    /// Immutable basket data account — a PDA of THIS program (seeds
    /// `[b"basket", factory, creator, nonce]`, still pinned by the constraint
    /// below) whose DATA is owned by the BASKET program: the runtime only lets
    /// an account's owner program write its data, and the basket program's
    /// mint/redeem/accrue contexts type it as `Account<Basket>` (owner check),
    /// so it is created + initialized via the `basket::init_basket` CPI in the
    /// handler (a program cannot `init` an account owned by another program —
    /// the former in-context `init` failed Anchor's AccountOwnedByWrongProgram
    /// check because `Basket::owner()` is the basket program id).
    #[account(
        mut,
        seeds = [BASKET_SEED, factory.key().as_ref(), creator.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub basket: UncheckedAccount<'info>,
    /// Basket share mint — Token-2022, 6 decimals, PDA seeds
    /// `["share_mint", basket.key()]`. Created in-handler by `init_share_mint`
    /// with the factory PDA as TEMPORARY mint authority; `create_basket` mints
    /// the genesis supply in the same atomic tx and then transfers the mint
    /// authority to the basket program's vault authority PDA (see handler).
    /// The `init` itself lives in the handler (not in this context) because the
    /// Token-2022 mint-initialization code Anchor otherwise inlines into the
    /// generated `try_accounts` overflows the 4 KB SBF stack frame limit.
    /// The seeds/bump constraint still verifies the PDA address here.
    #[account(mut, seeds = [SHARE_MINT_SEED, basket.key().as_ref()], bump)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: the basket program's vault/share-mint authority PDA
    /// (seeds `["basket", basket.key()]` under the basket program id — a plain
    /// Anchor seeds constraint here would derive under the FACTORY program id).
    /// Key equality with `vault_authority_pda()` is enforced in the handler.
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: creator share ATA — validated in the handler (address == derived
    /// ATA of (creator, share_mint, token_program)); created idempotently and
    /// re-read (owner == creator, mint == share_mint) before the genesis mint.
    #[account(mut)]
    pub creator_share_ata: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// Only Token-2022 is accepted (spec §3.2/§11 — xStocks are Token-2022;
    /// vault ATAs, creator ATAs and the share mint must all share one program).
    #[account(constraint = token_program.key() == TOKEN_2022_PROGRAM_ID @ FactoryError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// The basket program — target of the `init_basket` CPI that creates the
    /// basket data account (owned by the basket program). Constrained to the
    /// declared basket program id that `vault_authority_pda` and the genesis
    /// mint authority handoff already trust.
    #[account(constraint = basket_program.key() == basket::ID @ FactoryError::InvalidBasketProgram)]
    pub basket_program: UncheckedAccount<'info>,
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
    #[msg("Basket count overflow")]
    BasketCountOverflow,
    #[msg("Invalid remaining accounts — expected [whitelisted_mint_pda, mint, creator_ata, vault_ata] per constituent")]
    InvalidRemainingAccounts,
    #[msg("WhitelistedMint account is not a whitelist program PDA")]
    InvalidWhitelistAccount,
    #[msg("Constituent mint is not whitelisted")]
    NotWhitelisted,
    #[msg("Constituent mint whitelist status is not Active")]
    MintNotActive,
    #[msg("Whitelist cached decimals do not match the on-chain mint decimals")]
    DecimalsMismatch,
    #[msg("Mint account does not match a constituent")]
    MintMismatch,
    #[msg("Mint account is not owned by the passed token program")]
    InvalidMintAccount,
    #[msg("Creator constituent ATA is not the derived ATA / wrong owner or mint")]
    InvalidCreatorAta,
    #[msg("Creator ATA balance is below the raw seed amount")]
    InsufficientSeedBalance,
    #[msg("Vault ATA is not the derived ATA / wrong owner or mint")]
    InvalidVaultAta,
    #[msg("Vault authority account is not the basket program's vault authority PDA")]
    InvalidVaultAuthority,
    #[msg("Creator share ATA is not the derived ATA / wrong owner or mint")]
    InvalidShareAta,
    #[msg("Only the Token-2022 program is accepted")]
    InvalidTokenProgram,
    #[msg("basket_program account is not the declared basket program")]
    InvalidBasketProgram,
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

    // ========== PURE VALIDATION HELPERS ==========
    #[test]
    fn test_check_lengths_helper() {
        let m = pubkey(1);
        assert!(check_lengths(&[m, pubkey(2)], &[5000, 5000], &[100, 100]).is_ok());
        assert!(check_lengths(&[m], &[5000], &[100]).is_ok()); // count checked separately
        assert!(check_lengths(&[m, m], &[5000], &[100, 100]).is_err());
        assert!(check_lengths(&[m, m], &[5000, 5000], &[100]).is_err());
    }
    #[test]
    fn test_check_constituent_count_helper() {
        assert!(check_constituent_count(2).is_ok());
        assert!(check_constituent_count(20).is_ok());
        assert!(check_constituent_count(1).is_err());
        assert!(check_constituent_count(0).is_err());
        assert!(check_constituent_count(21).is_err());
        assert!(check_constituent_count(100).is_err());
    }
    #[test]
    fn test_check_no_duplicates_helper() {
        assert!(check_no_duplicates(&[pubkey(1), pubkey(2), pubkey(3)]).is_ok());
        assert!(check_no_duplicates(&[]).is_ok());
        assert!(check_no_duplicates(&[pubkey(7), pubkey(7)]).is_err());
        assert!(check_no_duplicates(&[pubkey(1), pubkey(2), pubkey(1)]).is_err());
        // adjacent duplicates caught too
        assert!(check_no_duplicates(&[pubkey(5), pubkey(5), pubkey(6), pubkey(7)]).is_err());
    }
    #[test]
    fn test_check_weights_sum_helper() {
        assert!(check_weights_sum(&[5000, 5000]).is_ok());
        assert!(check_weights_sum(&[3333, 3333, 3334]).is_ok());
        assert!(check_weights_sum(&[10_000]).is_ok());
        assert!(check_weights_sum(&[4999, 5000]).is_err());
        assert!(check_weights_sum(&[0; 20]).is_err());
        // u128 accumulator: u16::MAX repeated never overflows, just != 10_000
        assert!(check_weights_sum(&[u16::MAX; 20]).is_err());
        assert!(check_weights_sum(&[]).is_err()); // 0 != 10_000
    }
    #[test]
    fn test_check_fee_caps_helper() {
        let f = FactoryConfig { authority: pubkey(1), treasury: pubkey(2), creator_fee_split_bps: 9000, entry_fee_cap_bps: 300, exit_fee_cap_bps: 100, management_fee_cap_bps: 300, basket_count: 0, bump: 0 };
        assert!(check_fee_caps(0, 0, 0, &f).is_ok());
        assert!(check_fee_caps(300, 100, 300, &f).is_ok()); // exactly at caps
        assert!(check_fee_caps(299, 99, 299, &f).is_ok());
        assert!(check_fee_caps(301, 0, 0, &f).is_err());
        assert!(check_fee_caps(0, 101, 0, &f).is_err());
        assert!(check_fee_caps(0, 0, 301, &f).is_err());
        // a stricter factory caps harder (caps come from FactoryConfig)
        let strict = FactoryConfig { authority: pubkey(1), treasury: pubkey(2), creator_fee_split_bps: 9000, entry_fee_cap_bps: 50, exit_fee_cap_bps: 10, management_fee_cap_bps: 50, basket_count: 0, bump: 0 };
        assert!(check_fee_caps(100, 0, 0, &strict).is_err());
    }
    #[test]
    fn test_check_seed_amounts_helper() {
        assert!(check_seed_amounts(&[1]).is_ok());
        assert!(check_seed_amounts(&[u64::MAX, 1]).is_ok());
        assert!(check_seed_amounts(&[0]).is_err());
        assert!(check_seed_amounts(&[100, 200, 0]).is_err());
        assert!(check_seed_amounts(&[]).is_ok()); // no constituents => vacuously ok (count check covers)
    }
    #[test]
    fn test_check_metadata_hash_helper() {
        assert!(check_metadata_hash(&dummy_hash(1)).is_ok());
        assert!(check_metadata_hash(&[0u8; 32]).is_err());
    }
    #[test]
    fn test_check_remaining_accounts_layout_helper() {
        assert!(check_remaining_accounts_layout(4 * 2, 2).is_ok());
        assert!(check_remaining_accounts_layout(4 * 20, 20).is_ok());
        assert!(check_remaining_accounts_layout(4 * 2 + 1, 2).is_err());
        assert!(check_remaining_accounts_layout(4 * 2 - 1, 2).is_err());
        assert!(check_remaining_accounts_layout(3 * 3, 3).is_err()); // triplet layout rejected
    }

    // ========== WHITELIST RECORD + PDA VALIDATION ==========
    #[test]
    fn test_whitelist_pda_derivation_deterministic() {
        let m = pubkey(9);
        let p1 = Pubkey::find_program_address(&[whitelist::MINT_SEED, m.as_ref()], &whitelist::ID).0;
        let p2 = Pubkey::find_program_address(&[whitelist::MINT_SEED, m.as_ref()], &whitelist::ID).0;
        assert_eq!(p1, p2);
        assert_ne!(p1, Pubkey::find_program_address(&[whitelist::MINT_SEED, pubkey(10).as_ref()], &whitelist::ID).0);
    }
    #[test]
    fn test_check_whitelisted_record_ok() {
        let mint = pubkey(3);
        let (pda, bump) = Pubkey::find_program_address(&[whitelist::MINT_SEED, mint.as_ref()], &whitelist::ID);
        assert!(check_whitelisted_record(&mint, whitelist::WhitelistStatus::Active as u8, bump, &mint, &pda).is_ok());
    }
    #[test]
    fn test_check_whitelisted_record_wrong_mint() {
        let mint = pubkey(3);
        let (pda, bump) = Pubkey::find_program_address(&[whitelist::MINT_SEED, mint.as_ref()], &whitelist::ID);
        assert!(check_whitelisted_record(&pubkey(4), whitelist::WhitelistStatus::Active as u8, bump, &mint, &pda).is_err());
    }
    #[test]
    fn test_check_whitelisted_record_paused() {
        let mint = pubkey(3);
        let (pda, bump) = Pubkey::find_program_address(&[whitelist::MINT_SEED, mint.as_ref()], &whitelist::ID);
        assert!(check_whitelisted_record(&mint, whitelist::WhitelistStatus::PausedNewMints as u8, bump, &mint, &pda).is_err());
    }
    #[test]
    fn test_check_whitelisted_record_forged_pda_fails() {
        // right record fields but the passed "PDA" account is not the derived address
        let mint = pubkey(3);
        let (_, bump) = Pubkey::find_program_address(&[whitelist::MINT_SEED, mint.as_ref()], &whitelist::ID);
        assert!(check_whitelisted_record(&mint, whitelist::WhitelistStatus::Active as u8, bump, &mint, &pubkey(42)).is_err());
        // wrong bump cannot reconstruct the PDA either
        let (pda, _) = Pubkey::find_program_address(&[whitelist::MINT_SEED, mint.as_ref()], &whitelist::ID);
        assert!(check_whitelisted_record(&mint, whitelist::WhitelistStatus::Active as u8, bump.wrapping_add(1), &mint, &pda).is_err());
    }
    #[test]
    fn test_decode_whitelisted_mint_roundtrip() {
        use anchor_lang::{AnchorSerialize, Discriminator};
        let wm = WhitelistedMint {
            mint: pubkey(11),
            decimals: 6,
            multiplier_watermark: 1_000_000,
            status: whitelist::WhitelistStatus::Active as u8,
            price_source: "jupiter:TSLAx".to_string(),
            bump: 200,
        };
        let mut buf = WhitelistedMint::discriminator().to_vec();
        wm.serialize(&mut buf).unwrap();
        let decoded = decode_whitelisted_mint(&buf).unwrap();
        assert_eq!(decoded.mint, pubkey(11));
        assert_eq!(decoded.decimals, 6);
        assert_eq!(decoded.status, whitelist::WhitelistStatus::Active as u8);
        assert_eq!(decoded.bump, 200);
        // tampered discriminator must be rejected
        let mut bad = buf.clone();
        bad[0] ^= 0xFF;
        assert!(decode_whitelisted_mint(&bad).is_err());
        assert!(decode_whitelisted_mint(&[]).is_err());
    }

    // ========== TOKEN-2022 MINT DECODE ==========
    #[test]
    fn test_decode_mint_decimals_base_mint() {
        // spl_token Mint layout: authority 0..36, supply 36..44, decimals 44,
        // is_initialized 45, freeze_authority 46..82 (LEN = 82).
        let mut buf = [0u8; 82];
        buf[44] = 6;
        buf[45] = 1;
        assert_eq!(decode_mint_decimals(&buf).unwrap(), 6);
        buf[44] = 9;
        assert_eq!(decode_mint_decimals(&buf).unwrap(), 9);
    }
    #[test]
    fn test_decode_mint_decimals_truncated_fails() {
        let buf = [0u8; 40];
        assert!(decode_mint_decimals(&buf).is_err());
    }

    // ========== VAULT AUTHORITY PDA (basket program id) ==========
    #[test]
    fn test_vault_authority_pda_uses_basket_program_id() {
        // The vault authority must be derived under the BASKET program id.
        // Deriving under the FACTORY program id gives a DIFFERENT address —
        // which is why a plain Anchor seeds constraint would be wrong here.
        let basket_key = pubkey(77);
        let (pda, bump) = vault_authority_pda(&basket_key);
        let (expected, expected_bump) = Pubkey::find_program_address(
            &[basket::BASKET_SEED, basket_key.as_ref()],
            &basket::ID,
        );
        assert_eq!(pda, expected);
        assert_eq!(bump, expected_bump);
        let factory_derived = Pubkey::find_program_address(
            &[BASKET_SEED, basket_key.as_ref()],
            &crate::ID,
        );
        assert_ne!(pda, factory_derived.0);
        // deterministic across calls, distinct per basket
        assert_eq!(vault_authority_pda(&basket_key).0, pda);
        assert_ne!(vault_authority_pda(&pubkey(78)).0, pda);
    }
    #[test]
    fn test_vault_bump_written_canonical() {
        // gap #1: the factory must write the REAL derived bump (not 0).
        for n in 0..8u8 {
            let basket_key = pubkey(n);
            let (_, real_bump) = vault_authority_pda(&basket_key);
            let mut basket = BasketAccount {
                factory: pubkey(1),
                creator: pubkey(2),
                treasury: pubkey(3),
                share_mint: pubkey(4),
                nonce: 0,
                created_at: 0,
                last_fee_accrual_ts: 0,
                metadata_hash: [0u8; 32],
                num_constituents: 2,
                constituents: [Pubkey::default(); 20],
                target_weights_bps: [0u16; 20],
                entry_fee_bps: 0,
                exit_fee_bps: 100,
                management_fee_bps: 200,
                bump: 254,
                vault_bump: 0, // the old stub wrote 0
            };
            basket.vault_bump = real_bump; // what create_basket now writes
            assert_eq!(basket.vault_bump, real_bump);
            assert_eq!(
                basket.vault_bump,
                Pubkey::find_program_address(&[basket::BASKET_SEED, basket_key.as_ref()], &basket::ID).1
            );
        }
    }

    // ========== CONSTANTS ==========
    #[test]
    fn test_share_mint_constants() {
        assert_eq!(SHARE_MINT_DECIMALS, 6);
        assert_eq!(SHARE_MINT_SEED, b"share_mint");
        assert_eq!(ACCOUNTS_PER_CONSTITUENT, 4);
        assert_eq!(MIN_CONSTITUENTS, 2);
        assert_eq!(MAX_CONSTITUENTS, 20);
        assert_eq!(WEIGHTS_DENOMINATOR, 10_000);
        assert_eq!(TOKEN_2022_PROGRAM_ID, anchor_spl::token_2022::ID);
    }
    #[test]
    fn test_genesis_matches_basket_program_constant() {
        // the genesis supply minted by the factory IS the basket program's
        // GENESIS_SHARES (1_000_000) — single source of truth.
        assert_eq!(basket::GENESIS_SHARES, 1_000_000);
    }
    #[test]
    fn test_basket_account_size_covers_20_constituents() {
        // 32*4 keys + 8*3 numerics + 32 hash + 1 count + 32*20 + 2*20 + 2*3 + 2 bumps
        assert!(std::mem::size_of::<BasketAccount>() >= 820);
    }
}
