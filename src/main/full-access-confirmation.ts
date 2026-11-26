export async function confirmFullAccess(
  showDialog: () => Promise<{ response: number }>
): Promise<boolean> {
  try {
    return (await showDialog()).response === 0
  } catch {
    return false
  }
}
