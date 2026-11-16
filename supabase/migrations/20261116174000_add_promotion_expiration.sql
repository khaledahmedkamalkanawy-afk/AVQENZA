alter table public.listings
  add column if not exists featured_until timestamptz,
  add column if not exists urgent_until timestamptz;

create or replace function public.review_promotion_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.promotion_requests%rowtype;
begin
  if not coalesce((select public.is_admin()), false) then
    raise exception 'Not authorized';
  end if;

  select * into r
  from public.promotion_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Promotion request not found';
  end if;

  if r.status <> 'under_review' then
    raise exception 'Request is not ready for review';
  end if;

  if p_approve then
    update public.listings
    set
      is_featured = is_featured or (r.plan_key in ('featured_7d','featured_urgent_7d')),
      featured_until = case
        when r.plan_key in ('featured_7d','featured_urgent_7d') then
          case
            when is_featured and featured_until is null then null
            else greatest(coalesce(featured_until, now()), now()) + interval '7 days'
          end
        else featured_until
      end,
      is_urgent = is_urgent or (r.plan_key in ('urgent_3d','featured_urgent_7d')),
      urgent_until = case
        when r.plan_key = 'urgent_3d' then
          case
            when is_urgent and urgent_until is null then null
            else greatest(coalesce(urgent_until, now()), now()) + interval '3 days'
          end
        when r.plan_key = 'featured_urgent_7d' then
          case
            when is_urgent and urgent_until is null then null
            else greatest(coalesce(urgent_until, now()), now()) + interval '7 days'
          end
        else urgent_until
      end
    where id = r.listing_id and seller_id = r.seller_id and status = 'approved';

    if not found then
      raise exception 'Listing is no longer eligible';
    end if;
  end if;

  update public.promotion_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_request_id;
end;
$function$;
