use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("Goyim11111111111111111111111111111111111111");

#[program]
pub mod goyim_trade {
    use super::*;

    /// Initialize the global program configuration (admin settings and constants)
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_recipient: Pubkey,
        fee_basis_points: u16,
        initial_virtual_sol_reserves: u64,
        initial_virtual_token_reserves: u64,
    ) -> Result<()> {
        let global = &mut ctx.accounts.global;
        global.authority = ctx.accounts.authority.key();
        global.fee_recipient = fee_recipient;
        global.fee_basis_points = fee_basis_points;
        global.initial_virtual_sol_reserves = initial_virtual_sol_reserves;
        global.initial_virtual_token_reserves = initial_virtual_token_reserves;
        global.initialized = true;
        Ok(())
    }

    /// Create a new bonding curve pool for a newly minted SPL token
    pub fn create_pool(ctx: Context<CreatePool>, name: String, symbol: String) -> Result<()> {
        let global = &ctx.accounts.global;
        require!(global.initialized, GoyimError::NotInitialized);

        let bonding_curve = &mut ctx.accounts.bonding_curve;
        bonding_curve.mint = ctx.accounts.mint.key();
        bonding_curve.virtual_sol_reserves = global.initial_virtual_sol_reserves;
        bonding_curve.virtual_token_reserves = global.initial_virtual_token_reserves;
        bonding_curve.real_sol_reserves = 0;
        bonding_curve.real_token_reserves = global.initial_virtual_token_reserves;
        bonding_curve.completed = false;
        bonding_curve.bump = ctx.bumps.bonding_curve;

        // Transfer all initial mint tokens to the bonding curve's vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, global.initial_virtual_token_reserves)?;

        msg!("Bonding curve pool created for mint: {}", bonding_curve.mint);
        Ok(())
    }

    /// Buy tokens from the bonding curve using SOL
    pub fn buy(ctx: Context<Buy>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        let bonding_curve = &mut ctx.accounts.bonding_curve;
        require!(!bonding_curve.completed, GoyimError::BondingCurveCompleted);
        require!(sol_amount > 0, GoyimError::InvalidAmount);

        let global = &ctx.accounts.global;
        
        // Calculate trade fee
        let fee = (sol_amount as u128)
            .checked_mul(global.fee_basis_points as u128)
            .ok_or(GoyimError::MathOverflow)?
            .checked_div(10000)
            .ok_or(GoyimError::MathOverflow)? as u64;
            
        let sol_to_curve = sol_amount.checked_sub(fee).ok_or(GoyimError::MathOverflow)?;

        // Constant Product Formula: (Virtual SOL + SOL input) * (Virtual Tokens - Tokens Output) = K
        let current_k = (bonding_curve.virtual_sol_reserves as u128)
            .checked_mul(bonding_curve.virtual_token_reserves as u128)
            .ok_or(GoyimError::MathOverflow)?;

        let new_virtual_sol_reserves = (bonding_curve.virtual_sol_reserves as u128)
            .checked_add(sol_to_curve as u128)
            .ok_or(GoyimError::MathOverflow)?;

        let new_virtual_token_reserves = current_k
            .checked_div(new_virtual_sol_reserves)
            .ok_or(GoyimError::MathOverflow)?;

        let tokens_out = (bonding_curve.virtual_token_reserves as u128)
            .checked_sub(new_virtual_token_reserves)
            .ok_or(GoyimError::MathOverflow)? as u64;

        require!(tokens_out > 0, GoyimError::PriceTooHigh);
        require!(tokens_out >= min_tokens_out, GoyimError::SlippageExceeded);
        require!(tokens_out <= bonding_curve.real_token_reserves, GoyimError::InsufficientReserves);

        // Update reserves
        bonding_curve.virtual_sol_reserves = new_virtual_sol_reserves as u64;
        bonding_curve.virtual_token_reserves = new_virtual_token_reserves as u64;
        bonding_curve.real_sol_reserves = bonding_curve.real_sol_reserves.checked_add(sol_to_curve).ok_or(GoyimError::MathOverflow)?;
        bonding_curve.real_token_reserves = bonding_curve.real_token_reserves.checked_sub(tokens_out).ok_or(GoyimError::MathOverflow)?;

        // Transfer SOL from buyer to bonding curve account
        let transfer_sol_to_curve_ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.buyer.key,
            &bonding_curve.key(),
            sol_to_curve,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_sol_to_curve_ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                bonding_curve.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transfer SOL fee to fee recipient
        if fee > 0 {
            let transfer_fee_ix = anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.buyer.key,
                &global.fee_recipient,
                fee,
            );
            anchor_lang::solana_program::program::invoke(
                &transfer_fee_ix,
                &[
                    ctx.accounts.buyer.to_account_info(),
                    ctx.accounts.fee_recipient.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // Transfer tokens from vault to buyer's ATA
        let mint_key = bonding_curve.mint;
        let seeds = &[
            b"bonding-curve",
            mint_key.as_ref(),
            &[bonding_curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_tokens_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: bonding_curve.to_account_info(),
        };
        let transfer_tokens_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_tokens_accounts,
            signer_seeds,
        );
        token::transfer(transfer_tokens_ctx, tokens_out)?;

        // If real token reserves hit zero (or a threshold), mark pool completed
        if bonding_curve.real_token_reserves == 0 || bonding_curve.real_sol_reserves >= 85_000_000_000 {
            bonding_curve.completed = true;
            msg!("Bonding curve completed! Token ready for migration.");
        }

        msg!("Swapped SOL for {} tokens", tokens_out);
        Ok(())
    }

    /// Sell tokens back to the bonding curve for SOL
    pub fn sell(ctx: Context<Sell>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        let bonding_curve = &mut ctx.accounts.bonding_curve;
        require!(!bonding_curve.completed, GoyimError::BondingCurveCompleted);
        require!(token_amount > 0, GoyimError::InvalidAmount);

        let global = &ctx.accounts.global;

        // Constant Product Formula: (Virtual SOL - SOL Output) * (Virtual Tokens + Token Input) = K
        let current_k = (bonding_curve.virtual_sol_reserves as u128)
            .checked_mul(bonding_curve.virtual_token_reserves as u128)
            .ok_or(GoyimError::MathOverflow)?;

        let new_virtual_token_reserves = (bonding_curve.virtual_token_reserves as u128)
            .checked_add(token_amount as u128)
            .ok_or(GoyimError::MathOverflow)?;

        let new_virtual_sol_reserves = current_k
            .checked_div(new_virtual_token_reserves)
            .ok_or(GoyimError::MathOverflow)?;

        let raw_sol_out = (bonding_curve.virtual_sol_reserves as u128)
            .checked_sub(new_virtual_sol_reserves)
            .ok_or(GoyimError::MathOverflow)? as u64;

        // Deduct fee
        let fee = (raw_sol_out as u128)
            .checked_mul(global.fee_basis_points as u128)
            .ok_or(GoyimError::MathOverflow)?
            .checked_div(10000)
            .ok_or(GoyimError::MathOverflow)? as u64;

        let sol_to_user = raw_sol_out.checked_sub(fee).ok_or(GoyimError::MathOverflow)?;

        require!(sol_to_user >= min_sol_out, GoyimError::SlippageExceeded);
        require!(sol_to_user <= bonding_curve.real_sol_reserves, GoyimError::InsufficientReserves);

        // Update reserves
        bonding_curve.virtual_sol_reserves = new_virtual_sol_reserves as u64;
        bonding_curve.virtual_token_reserves = new_virtual_token_reserves as u64;
        bonding_curve.real_sol_reserves = bonding_curve.real_sol_reserves.checked_sub(raw_sol_out).ok_or(GoyimError::MathOverflow)?;
        bonding_curve.real_token_reserves = bonding_curve.real_token_reserves.checked_add(token_amount).ok_or(GoyimError::MathOverflow)?;

        // Transfer tokens from seller's ATA to curve vault
        let transfer_tokens_accounts = Transfer {
            from: ctx.accounts.seller_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        let transfer_tokens_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_tokens_accounts,
        );
        token::transfer(transfer_tokens_ctx, token_amount)?;

        // Transfer SOL from bonding curve to seller
        **bonding_curve.to_account_info().try_borrow_mut_lamports()? = bonding_curve
            .to_account_info()
            .lamports()
            .checked_sub(sol_to_user)
            .ok_or(GoyimError::MathOverflow)?;
        **ctx.accounts.seller.try_borrow_mut_lamports()? = ctx.accounts
            .seller
            .lamports()
            .checked_add(sol_to_user)
            .ok_or(GoyimError::MathOverflow)?;

        // Transfer SOL fee to fee recipient
        if fee > 0 {
            **bonding_curve.to_account_info().try_borrow_mut_lamports()? = bonding_curve
                .to_account_info()
                .lamports()
                .checked_sub(fee)
                .ok_or(GoyimError::MathOverflow)?;
            **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? = ctx.accounts
                .fee_recipient
                .lamports()
                .checked_add(fee)
                .ok_or(GoyimError::MathOverflow)?;
        }

        msg!("Swapped {} tokens for SOL", token_amount);
        Ok(())
    }

    /// Migrate pool to Raydium DEX once bonding curve is successfully finalized
    pub fn finalize_pool(ctx: Context<FinalizePool>) -> Result<()> {
        let bonding_curve = &mut ctx.accounts.bonding_curve;
        require!(bonding_curve.completed, GoyimError::BondingCurveNotCompleted);

        // Migrate remaining tokens and SOL reserves to the authority/DEX migrator address
        let sol_reserves = bonding_curve.real_sol_reserves;
        let token_reserves = bonding_curve.real_token_reserves;

        let mint_key = bonding_curve.mint;
        let seeds = &[
            b"bonding-curve",
            mint_key.as_ref(),
            &[bonding_curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer remaining tokens to authority migration account
        let transfer_tokens_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: bonding_curve.to_account_info(),
        };
        let transfer_tokens_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_tokens_accounts,
            signer_seeds,
        );
        token::transfer(transfer_tokens_ctx, token_reserves)?;

        // Transfer accumulated SOL to migration authority
        **bonding_curve.to_account_info().try_borrow_mut_lamports()? = bonding_curve
            .to_account_info()
            .lamports()
            .checked_sub(sol_reserves)
            .ok_or(GoyimError::MathOverflow)?;
        **ctx.accounts.authority.try_borrow_mut_lamports()? = ctx.accounts
            .authority
            .lamports()
            .checked_add(sol_reserves)
            .ok_or(GoyimError::MathOverflow)?;

        msg!("Bonding curve successfully finalized. SOL and remaining tokens migrated for liquidity initialization.");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Global::SIZE,
        seeds = [b"global"],
        bump
    )]
    pub global: Account<'info, Global>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    #[account(
        init,
        payer = creator,
        space = 8 + BondingCurve::SIZE,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    #[account(
        mut,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = fee_recipient.key() == global.fee_recipient)]
    /// CHECK: Safe because we check address constraint
    pub fee_recipient: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    #[account(
        mut,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = fee_recipient.key() == global.fee_recipient)]
    /// CHECK: Safe because we check address constraint
    pub fee_recipient: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizePool<'info> {
    #[account(seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    #[account(
        mut,
        seeds = [b"bonding-curve", mint.key().as_ref()],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority.key() == global.authority)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct Global {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub fee_basis_points: u16,
    pub initial_virtual_sol_reserves: u64,
    pub initial_virtual_token_reserves: u64,
    pub initialized: bool,
}

impl Global {
    pub const SIZE: usize = 32 + 32 + 2 + 8 + 8 + 1;
}

#[account]
pub struct BondingCurve {
    pub mint: Pubkey,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub completed: bool,
    pub bump: u8,
}

impl BondingCurve {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[error_code]
pub enum GoyimError {
    #[msg("Bonding curve global system configuration is not initialized.")]
    NotInitialized,
    #[msg("Bonding curve is already complete. Pool finalized.")]
    BondingCurveCompleted,
    #[msg("Bonding curve requires more SOL to complete before migrating to Raydium.")]
    BondingCurveNotCompleted,
    #[msg("Trade amount exceeds virtual reserves capacity.")]
    InsufficientReserves,
    #[msg("Provided token/SOL swap amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Price slippage tolerance has been exceeded.")]
    SlippageExceeded,
    #[msg("Virtual token calculated output is zero or invalid.")]
    PriceTooHigh,
    #[msg("Calculation triggered an arithmetic overflow/underflow.")]
    MathOverflow,
}
