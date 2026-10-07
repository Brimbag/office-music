export async function onRequestGet(context) {
  try {
    const row = await context.env.DB
      .prepare("SELECT 1 AS ok")
      .first();

    return Response.json({
      ok: true,
      database: row?.ok === 1
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: String(error)
      },
      { status: 500 }
    );
  }
}
