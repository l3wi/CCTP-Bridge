import { Button } from "@/components/ui/button"
import { CheckCircle, ExternalLink } from "lucide-react"

export function TransactionHistory() {
  const transactions = [
    {
      date: "10/06/2025",
      origin: "Base",
      destination: "Arbitrum",
      status: "Completed",
      txHash: "0x123...",
    },
    {
      date: "10/06/2025",
      origin: "Arbitrum",
      destination: "Base",
      status: "Completed",
      txHash: "0x456...",
    },
    {
      date: "09/06/2025",
      origin: "Base",
      destination: "Polygon",
      status: "Completed",
      txHash: "0x789...",
    },
  ]

  return (
    <div>
      <div className="p-4 border-b">
        <h2 className="text-lg font-medium text-gray-800">Transaction History</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 text-left text-sm text-gray-500">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Origin</th>
              <th className="px-4 py-3 font-medium">Destination</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transactions.map((tx, i) => (
              <tr key={i} className="text-sm">
                <td className="px-4 py-3 text-gray-600">{tx.date}</td>
                <td className="px-4 py-3">
                  <span className="text-blue-600 font-medium">{tx.origin}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-blue-600 font-medium">{tx.destination}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-green-600">{tx.status}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
