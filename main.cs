using UnityEngine;

public class BackroomsGenerator : MonoBehaviour
{
    public GameObject wallPrefab;
    public int width = 20;
    public int height = 20;
    public float cellSize = 10f;

    void Start()
    {
        Generate();
    }

    void Generate()
    {
        for (int x = 0; x < width; x++)
        {
            for (int z = 0; z < height; z++)
            {
                Vector3 basePos = new Vector3(x * cellSize, 0, z * cellSize);

                // Create perimeter walls
                if (x == 0 || z == 0 || x == width - 1 || z == height - 1)
                {
                    SpawnWall(basePos);
                    continue;
                }

                // Random inner walls (less chaotic)
                if (Random.value > 0.75f)
                {
                    SpawnWall(basePos);
                }
            }
        }
    }

    void SpawnWall(Vector3 position)
    {
        Instantiate(wallPrefab, position + Vector3.up * 2.5f, Quaternion.identity);
    }
}
